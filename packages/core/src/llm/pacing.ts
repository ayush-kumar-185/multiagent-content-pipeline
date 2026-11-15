/**
 * Token-aware pacing for LLM providers (e.g. Groq) that return
 * x-ratelimit-remaining-tokens and reset headers.
 */

export interface ModelPacingState {
  remainingTokens: number;
  resetAtMs: number;
  limitTokens?: number;
}

const pacingMap = new Map<string, ModelPacingState>();

export const MAX_SINGLE_WAIT_MS = 70_000; // 70 seconds cap per spec

/**
 * Parses duration strings like "6s", "1.2s", "600ms", "1m15s", or decimal seconds into milliseconds.
 */
export function parseResetDurationMs(resetStr?: string): number {
  if (!resetStr) return 0;
  const str = resetStr.trim().toLowerCase();

  // Handle format like "1m15s" or "2m"
  const mMatch = str.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?(?:\s*(\d+(?:\.\d+)?)\s*s)?$/);
  if (mMatch) {
    const mins = parseFloat(mMatch[1] ?? '0');
    const secs = parseFloat(mMatch[2] ?? '0');
    return Math.round((mins * 60 + secs) * 1000);
  }

  // Handle format like "600ms"
  const msMatch = str.match(/^(\d+(?:\.\d+)?)\s*ms$/);
  if (msMatch) {
    return Math.round(parseFloat(msMatch[1] ?? '0'));
  }

  // Handle format like "6s" or "1.5s"
  const sMatch = str.match(/^(\d+(?:\.\d+)?)\s*s$/);
  if (sMatch) {
    return Math.round(parseFloat(sMatch[1] ?? '0') * 1000);
  }

  // Plain number of seconds (e.g. from Retry-After header: "5")
  const num = parseFloat(str);
  if (!isNaN(num) && isFinite(num) && num > 0) {
    return Math.round(num * 1000);
  }

  return 0;
}

/**
 * Updates pacing state for a model using headers returned by the provider.
 */
export function updatePacingState(model: string, headers: Record<string, string>): void {
  const remainingStr =
    headers['x-ratelimit-remaining-tokens'] ?? headers['x-ratelimit-remaining-tokens-minute'];
  if (remainingStr === undefined) return;

  const remainingTokens = parseInt(remainingStr, 10);
  if (isNaN(remainingTokens)) return;

  const resetStr =
    headers['x-ratelimit-reset-tokens'] ??
    headers['x-ratelimit-reset-tokens-minute'] ??
    headers['retry-after'];
  const durationMs = parseResetDurationMs(resetStr);

  const limitStr = headers['x-ratelimit-limit-tokens'];
  const limitTokens = limitStr ? parseInt(limitStr, 10) : undefined;

  pacingMap.set(model, {
    remainingTokens,
    resetAtMs: Date.now() + Math.max(durationMs, 0),
    limitTokens: !isNaN(Number(limitTokens)) ? limitTokens : undefined,
  });
}

/**
 * Calculates the required wait duration in milliseconds before a call can be made.
 */
export function getPacingWaitMs(
  model: string,
  estimatedNeededTokens: number,
  nowMs: number = Date.now(),
): number {
  const state = pacingMap.get(model);
  if (!state) return 0;

  // If the reset period has elapsed, the bucket has refreshed
  if (nowMs >= state.resetAtMs) {
    return 0;
  }

  // If remaining tokens can satisfy the estimated requirement, no wait needed
  if (state.remainingTokens >= estimatedNeededTokens) {
    return 0;
  }

  // Remaining tokens are insufficient: wait until reset time
  const waitMs = state.resetAtMs - nowMs;
  return Math.min(Math.max(waitMs, 0), MAX_SINGLE_WAIT_MS);
}

/**
 * Waits before initiating an LLM call if the estimated token requirement exceeds remaining tokens.
 * Logs each wait and caps single wait at 70 seconds.
 */
export async function waitForPacing(
  model: string,
  estimatedNeededTokens: number,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<number> {
  const waitMs = getPacingWaitMs(model, estimatedNeededTokens);
  if (waitMs <= 0) return 0;

  console.warn(
    `[Pacing] Rate-limit pacing: waiting ${waitMs}ms before calling model "${model}" (estimated needed: ${estimatedNeededTokens} tokens, remaining: ${pacingMap.get(model)?.remainingTokens})...`,
  );

  await sleepFn(waitMs);
  return waitMs;
}

/**
 * Gets the current pacing state for a model (primarily for inspection/testing).
 */
export function getPacingState(model: string): ModelPacingState | undefined {
  return pacingMap.get(model);
}

/**
 * Resets the in-memory pacing state (useful between unit tests).
 */
export function resetPacingState(): void {
  pacingMap.clear();
}

