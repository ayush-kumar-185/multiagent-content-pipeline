import { validateUrlSecurity, SSRFBlockedError } from './ssrfFilter.js';
import { extractReadableTextFromHtml, ExtractedPageText } from './htmlExtractor.js';

export const MAX_RESPONSE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds
export const MAX_REDIRECTS = 3;

export const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'application/xhtml+xml',
  'application/json',
];

export interface FetchPageResult {
  url: string;
  finalUrl: string;
  contentType: string;
  title: string;
  rawText: string;
  wrappedText: string;
  sizeBytes: number;
}

export interface FetchPageOptions {
  timeoutMs?: number;
  maxSizeBytes?: number;
  maxRedirects?: number;
  customFetch?: typeof fetch;
}

export class FetchSecurityError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'FetchSecurityError';
    this.code = code;
  }
}

/**
 * Hardened fetch_page function with:
 * - SSRF protection (private/loopback/metadata IP blocking)
 * - Size cap (2 MB)
 * - Timeout (10 s)
 * - Redirect limit (3) with re-validation on every redirect hop
 * - Content-Type validation (text only)
 */
export async function fetchPage(
  urlString: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxSizeBytes = MAX_RESPONSE_SIZE_BYTES,
    maxRedirects = MAX_REDIRECTS,
    customFetch = fetch,
  } = options;

  let currentUrl = urlString;
  let redirectsCount = 0;

  while (true) {
    // 1. SSRF & Protocol Check
    const validatedUrl = await validateUrlSecurity(currentUrl);

    // 2. Setup Timeout Controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await customFetch(validatedUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'CiteWriter-Bot/1.0 (+https://github.com/citewriter/citewriter)',
          Accept:
            'text/html, text/plain, text/markdown, application/xhtml+xml, application/json;q=0.9',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof SSRFBlockedError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new FetchSecurityError(`Request timed out after ${timeoutMs}ms`, 'TIMEOUT');
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new FetchSecurityError(`Network fetch error: ${msg}`, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeoutId);
    }

    // 3. Handle HTTP Redirects
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      redirectsCount++;
      if (redirectsCount > maxRedirects) {
        throw new FetchSecurityError(
          `Maximum redirect limit (${maxRedirects}) exceeded`,
          'TOO_MANY_REDIRECTS',
        );
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new FetchSecurityError(
          'Redirect received without Location header',
          'INVALID_REDIRECT',
        );
      }

      // Resolve relative redirect against current URL
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new FetchSecurityError(
        `HTTP error status ${response.status}: ${response.statusText}`,
        'HTTP_ERROR',
      );
    }

    // 4. Content-Type Whitelist Check
    const rawContentType = response.headers.get('content-type') || 'text/plain';
    const cleanContentType = rawContentType.split(';')[0]?.trim().toLowerCase() || '';

    const isAllowedType = ALLOWED_CONTENT_TYPES.some((allowed) =>
      cleanContentType.includes(allowed),
    );
    if (!isAllowedType) {
      throw new FetchSecurityError(
        `Disallowed Content-Type "${cleanContentType}". Only text content types are permitted.`,
        'DISALLOWED_CONTENT_TYPE',
      );
    }

    // 5. Header-based Content-Length Check
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const declaredSize = parseInt(contentLengthHeader, 10);
      if (!isNaN(declaredSize) && declaredSize > maxSizeBytes) {
        throw new FetchSecurityError(
          `Declared content size (${declaredSize} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
          'PAYLOAD_TOO_LARGE',
        );
      }
    }

    // 6. Body Streaming Size Enforcement
    let textBody: string;
    if (!response.body) {
      textBody = await response.text();
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > maxSizeBytes) {
            await reader.cancel();
            throw new FetchSecurityError(
              `Response payload exceeded maximum size limit (${maxSizeBytes} bytes)`,
              'PAYLOAD_TOO_LARGE',
            );
          }
          chunks.push(value);
        }
      }

      // Combine chunks into string
      const fullBuffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      textBody = new TextDecoder('utf-8').decode(fullBuffer);
    }

    // 7. Extract readable text & wrap with security delimiters
    let extracted: ExtractedPageText;
    if (cleanContentType.includes('html') || cleanContentType.includes('xhtml')) {
      extracted = extractReadableTextFromHtml(textBody);
    } else {
      const title = 'Plain Document';
      const rawText = textBody.trim();
      const wrappedText = `<<<START_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>\n[SOURCE TITLE: ${title}]\n\n${rawText}\n<<<END_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>`;
      extracted = { title, rawText, wrappedText };
    }

    return {
      url: urlString,
      finalUrl: currentUrl,
      contentType: cleanContentType,
      title: extracted.title,
      rawText: extracted.rawText,
      wrappedText: extracted.wrappedText,
      sizeBytes: textBody.length,
    };
  }
}
