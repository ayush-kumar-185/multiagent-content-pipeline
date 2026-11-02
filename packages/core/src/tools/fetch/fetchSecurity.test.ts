import { describe, it, expect, vi } from 'vitest';
import { isPrivateIP, validateUrlSecurity, SSRFBlockedError } from './ssrfFilter.js';
import { fetchPage, FetchSecurityError } from './fetchPage.js';

describe('Fetch Safety & SSRF Filter', () => {
  it('correctly identifies private, loopback, link-local, and metadata IPv4/IPv6', () => {
    // Loopback
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.1.2.3')).toBe(true);
    expect(isPrivateIP('::1')).toBe(true);

    // Private IPv4
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('172.16.0.5')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);

    // Cloud Metadata Address (AWS, GCP, Azure)
    expect(isPrivateIP('169.254.169.254')).toBe(true);
    expect(isPrivateIP('169.254.1.1')).toBe(true);

    // Reserved / Broadcast
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('255.255.255.255')).toBe(true);

    // Public IPv4 addresses should NOT be private
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('93.184.216.34')).toBe(false); // example.com
  });

  it('validateUrlSecurity blocks localhost, private IPs, and non-http protocols', async () => {
    // Protocols
    await expect(validateUrlSecurity('file:///etc/passwd')).rejects.toThrow(SSRFBlockedError);
    await expect(validateUrlSecurity('ftp://example.com/file')).rejects.toThrow(SSRFBlockedError);
    await expect(validateUrlSecurity('javascript:alert(1)')).rejects.toThrow(SSRFBlockedError);

    // Localhost
    await expect(validateUrlSecurity('http://localhost:3000')).rejects.toThrow(SSRFBlockedError);
    await expect(validateUrlSecurity('http://127.0.0.1:8080')).rejects.toThrow(SSRFBlockedError);
    await expect(validateUrlSecurity('http://[::1]:8080')).rejects.toThrow(SSRFBlockedError);

    // Cloud metadata
    await expect(validateUrlSecurity('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      SSRFBlockedError,
    );

    // Private ranges
    await expect(validateUrlSecurity('http://192.168.0.1/admin')).rejects.toThrow(SSRFBlockedError);
    await expect(validateUrlSecurity('http://10.1.2.3/internal')).rejects.toThrow(SSRFBlockedError);
  });

  it('blocks non-text Content-Types', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
        },
      }),
    );

    await expect(
      fetchPage('https://example.com/logo.png', {
        customFetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(FetchSecurityError);

    await expect(
      fetchPage('https://example.com/logo.png', {
        customFetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Disallowed Content-Type "image\/png"/);
  });

  it('blocks responses with Content-Length exceeding 2 MB', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('small content', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': String(3 * 1024 * 1024), // 3 MB
        },
      }),
    );

    await expect(
      fetchPage('https://example.com/huge.html', {
        customFetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(FetchSecurityError);

    await expect(
      fetchPage('https://example.com/huge.html', {
        customFetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/exceeds maximum limit/);
  });

  it('blocks responses when streamed chunk size exceeds 2 MB', async () => {
    // Generate fresh response for each fetch invocation
    const createLargeResponse = () => {
      const largeChunk = new Uint8Array(2.5 * 1024 * 1024);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(largeChunk);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    };

    const mockFetch = vi.fn().mockImplementation(async () => createLargeResponse());

    await expect(
      fetchPage('https://example.com/stream-huge.txt', {
        customFetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(FetchSecurityError);

    await expect(
      fetchPage('https://example.com/stream-huge.txt', {
        customFetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/exceeded maximum size limit/);
  });

  it('enforces redirect limit (max 3 redirects)', async () => {
    let redirectCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      redirectCount++;
      return new Response('', {
        status: 302,
        headers: {
          Location: `https://example.com/redirect-${redirectCount}`,
        },
      });
    });

    await expect(
      fetchPage('https://example.com/start', {
        customFetch: mockFetch as unknown as typeof fetch,
        maxRedirects: 3,
      }),
    ).rejects.toThrow(/Maximum redirect limit \(3\) exceeded/);

    expect(redirectCount).toBe(4);
  });

  it('wraps fetched content in untrusted delimiters and extracts title', async () => {
    const html = `
      <html>
        <head><title>Technical Documentation</title></head>
        <body>
          <script>console.log("malicious");</script>
          <main>
            <h1>Overview</h1>
            <p>PostgreSQL 16 introduced bidirectional logical replication.</p>
          </main>
        </body>
      </html>
    `;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
    );

    const result = await fetchPage('https://example.com/docs', {
      customFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.title).toBe('Technical Documentation');
    expect(result.rawText).toContain('PostgreSQL 16 introduced bidirectional logical replication.');
    expect(result.rawText).not.toContain('malicious');
    expect(result.wrappedText).toContain('<<<START_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>');
    expect(result.wrappedText).toContain('<<<END_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>');
  });
});
