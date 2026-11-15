import fs from 'fs';
import path from 'path';
import os from 'os';

export interface DailyModelTokens {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
  failedCalls: number;
}

export type DailyLedgerData = Record<string, Record<string, DailyModelTokens>>;

const warnedModelsToday = new Set<string>();

/**
 * Normalizes a model identifier into an environment variable suffix for daily limits.
 * e.g. "openai/gpt-oss-120b" -> "DAILY_TOKEN_LIMIT_OPENAI_GPT_OSS_120B" or "DAILY_TOKEN_LIMIT_GPT_OSS_120B"
 */
export function getModelDailyLimit(model: string): number | null {
  const clean = model.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const shortClean = model.replace(/^.*\//, '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');

  const envVal =
    process.env[`DAILY_TOKEN_LIMIT_${clean}`] ??
    process.env[`DAILY_TOKEN_LIMIT_${shortClean}`] ??
    process.env.DAILY_TOKEN_LIMIT_DEFAULT;

  if (envVal !== undefined && !isNaN(Number(envVal)) && Number(envVal) > 0) {
    return Number(envVal);
  }

  // Fallback defaults from known free tier limits if not configured
  if (clean.includes('GPT_OSS_120B') || clean.includes('GPT_OSS_20B') || clean.includes('QWEN3_8_27B')) {
    return 200_000;
  }
  if (clean.includes('ALLAM_2_7B')) {
    return 500_000;
  }
  // Note: Gemini / Google AI Studio daily token limit is unknown (omitted from API headers).

  return null;
}

export function findRepoRoot(): string {
  let cur = process.cwd();
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, 'pnpm-workspace.yaml'))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return process.cwd();
}

export function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

export function getLedgerFilePath(): string {
  if (process.env.AUDIT_DIR) {
    const customPath = path.join(path.resolve(process.env.AUDIT_DIR), 'ledger.json');
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
    return path.join(os.tmpdir(), 'citewriter-test-audit', 'ledger.json');
  }

  return path.join(findRepoRoot(), 'token-audit', 'ledger.json');
}

/**
 * Loads the current daily ledger data from disk.
 */
export function loadDailyLedger(): DailyLedgerData {
  try {
    const filePath = getLedgerFilePath();
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as DailyLedgerData;
    }
  } catch (err) {
    console.warn('[DailyLedger] Failed to load ledger from disk:', err);
  }
  return {};
}

/**
 * Persists the daily ledger data to disk.
 */
export function saveDailyLedger(data: DailyLedgerData): void {
  try {
    const filePath = getLedgerFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[DailyLedger] Failed to save ledger to disk:', err);
  }
}

/**
 * Records token consumption for a model on the current UTC day.
 * Logs a warning if total consumption exceeds 80% of the model's configured daily limit.
 */
export function recordDailyTokens(
  model: string,
  promptTokens: number,
  completionTokens: number,
  isFailed: boolean = false,
  customDateUtc?: string,
): DailyModelTokens {
  const dateKey = customDateUtc ?? new Date().toISOString().slice(0, 10);
  const ledger = loadDailyLedger();

  if (!ledger[dateKey]) {
    ledger[dateKey] = {};
  }

  const current = ledger[dateKey][model] ?? {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
    failedCalls: 0,
  };

  const totalAdded = promptTokens + completionTokens;
  current.promptTokens += promptTokens;
  current.completionTokens += completionTokens;
  current.totalTokens += totalAdded;
  current.calls += 1;
  if (isFailed) {
    current.failedCalls += 1;
  }

  ledger[dateKey][model] = current;
  saveDailyLedger(ledger);

  // Check 80% daily limit warning
  const dailyLimit = getModelDailyLimit(model);
  if (dailyLimit && dailyLimit > 0) {
    const warnKey = `${dateKey}:${model}`;
    if (current.totalTokens >= 0.8 * dailyLimit && !warnedModelsToday.has(warnKey)) {
      warnedModelsToday.add(warnKey);
      const pct = ((current.totalTokens / dailyLimit) * 100).toFixed(1);
      console.warn(
        `[DailyLedger Warning] Model "${model}" has used ${current.totalTokens} tokens today (${pct}%), exceeding 80% of its daily limit (${dailyLimit} tokens).`,
      );
    }
  }

  return current;
}

/**
 * Gets the token consumption for a model on a given UTC date (defaults to today).
 */
export function getDailyModelTokens(
  model: string,
  dateUtc: string = new Date().toISOString().slice(0, 10),
): DailyModelTokens | undefined {
  const ledger = loadDailyLedger();
  return ledger[dateUtc]?.[model];
}

/**
 * Clears the in-memory warning tracking (primarily for testing).
 */
export function resetDailyLedgerWarnings(): void {
  warnedModelsToday.clear();
}

