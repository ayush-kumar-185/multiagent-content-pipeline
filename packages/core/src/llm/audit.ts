import fs from 'fs';
import path from 'path';
import os from 'os';
import { findRepoRoot, isTestEnv } from './ledger.js';

export interface TokenAuditRecord {
  run_id: string;
  agent_name: string;
  node_name: string;
  model_id: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  finish_reason: string | null;
  latency_ms: number;
  attempt: number;
  counted_as_attempt: boolean;
  is_retry: boolean;
  is_estimated: boolean;
  is_truncated: boolean;
  rate_limit_headers: Record<string, string>;
  error?: {
    status?: number;
    body?: unknown;
  };
  timestamp: string;
}

/**
 * Extracts all rate limit headers (x-ratelimit* and retry-after) from raw response or error headers.
 */
export function extractRateLimitHeaders(rawHeaders?: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawHeaders) return result;

  if (typeof (rawHeaders as Headers).forEach === 'function') {
    (rawHeaders as Headers).forEach((val: string, key: string) => {
      const lower = key.toLowerCase();
      if (lower.startsWith('x-ratelimit') || lower === 'retry-after') {
        result[lower] = String(val);
      }
    });
  } else if (typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      const lower = k.toLowerCase();
      if (lower.startsWith('x-ratelimit') || lower === 'retry-after') {
        result[lower] = String(v);
      }
    }
  }
  return result;
}

/**
 * Extracts reasoning/thinking tokens reported by any provider (OpenAI, Groq, Gemini, Anthropic).
 */
export function extractReasoningTokens(usage?: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const details = u.completion_tokens_details as Record<string, unknown> | undefined;
  if (details && typeof details === 'object') {
    if (typeof details.reasoning_tokens === 'number') return details.reasoning_tokens;
    if (typeof details.thinking_tokens === 'number') return details.thinking_tokens;
  }
  if (typeof u.reasoning_tokens === 'number') return u.reasoning_tokens;
  if (typeof u.thinking_tokens === 'number') return u.thinking_tokens;
  return null;
}

/**
 * Checks whether token auditing is active via TOKEN_AUDIT=1 environment flag.
 */
export function isTokenAuditEnabled(): boolean {
  return process.env.TOKEN_AUDIT === '1';
}

export function getAuditFilePath(): string {
  if (process.env.AUDIT_DIR) {
    const customPath = path.join(path.resolve(process.env.AUDIT_DIR), 'calls.jsonl');
    if (isTestEnv()) {
      const prodDir = path.resolve(findRepoRoot(), 'token-audit');
      if (path.resolve(customPath).startsWith(prodDir)) {
        throw new Error(
          `Safety violation: Test attempted to write to production token-audit directory: ${customPath}`,
        );
      }
    }
    return customPath;
  }

  if (isTestEnv()) {
    return path.join(os.tmpdir(), 'citewriter-test-audit', 'calls.jsonl');
  }

  return path.join(findRepoRoot(), 'token-audit', 'calls.jsonl');
}

/**
 * Appends a structured audit record to token-audit/calls.jsonl.
 * Completely no-op when TOKEN_AUDIT !== '1'.
 */
export function recordTokenAudit(record: TokenAuditRecord): void {
  if (!isTokenAuditEnabled()) return;

  try {
    const filePath = getAuditFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const sanitizedRecord = {
      ...record,
      rate_limit_headers: sanitizeHeaders(record.rate_limit_headers),
      error: record.error ? sanitizeError(record.error) : undefined,
    };

    const line = JSON.stringify(sanitizedRecord) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch (err) {
    console.warn('Failed to append to token audit log:', err);
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    // Exclude authorization, cookie, or API key headers
    if (
      lower.includes('auth') ||
      lower.includes('key') ||
      lower.includes('secret') ||
      lower.includes('cookie')
    ) {
      continue;
    }
    clean[lower] = String(val);
  }
  return clean;
}

function sanitizeError(err: { status?: number; body?: unknown }): { status?: number; body?: unknown } {
  const sanitizeStr = (str: string) =>
    str.replace(
      /(gsk_[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9_.-]+)/gi,
      '[REDACTED]',
    );

  let cleanBody = err.body;
  if (typeof cleanBody === 'string') {
    cleanBody = sanitizeStr(cleanBody);
  } else if (cleanBody && typeof cleanBody === 'object') {
    try {
      cleanBody = JSON.parse(sanitizeStr(JSON.stringify(cleanBody)));
    } catch {
      cleanBody = '[Unserializable Error Body]';
    }
  }

  return {
    status: err.status,
    body: cleanBody,
  };
}
