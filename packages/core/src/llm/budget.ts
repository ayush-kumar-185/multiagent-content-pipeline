import { BudgetLimits } from './types.js';
import type { RunConfig } from '../schemas/config.js';

export class BudgetExceededError extends Error {
  public readonly tokensUsed: number;
  public readonly costUsd: number;
  public readonly limitType: 'tokens' | 'cost';

  constructor(message: string, tokensUsed: number, costUsd: number, limitType: 'tokens' | 'cost') {
    super(message);
    this.name = 'BudgetExceededError';
    this.tokensUsed = tokensUsed;
    this.costUsd = costUsd;
    this.limitType = limitType;
  }
}

export function getBudgetLimitsFromEnv(): BudgetLimits {
  const maxRunTokens = process.env.MAX_RUN_TOKENS ? Number(process.env.MAX_RUN_TOKENS) : 100_000;

  const maxRunCostUsd = process.env.MAX_RUN_COST_USD ? Number(process.env.MAX_RUN_COST_USD) : 1.5;

  return {
    maxRunTokens,
    maxRunCostUsd,
  };
}

export function resolveBudgetLimits(
  config?: RunConfig,
  envLimits: BudgetLimits = getBudgetLimitsFromEnv(),
): BudgetLimits {
  return {
    maxRunTokens: config?.maxTokens ?? envLimits.maxRunTokens,
    maxRunCostUsd: config?.maxCostUsd ?? envLimits.maxRunCostUsd,
  };
}

export function checkBudget(
  tokensUsed: number,
  costUsd: number,
  limits: BudgetLimits = getBudgetLimitsFromEnv(),
): { exceeded: boolean; reason?: string; limitType?: 'tokens' | 'cost' } {
  if (tokensUsed >= limits.maxRunTokens) {
    return {
      exceeded: true,
      limitType: 'tokens',
      reason: `Token budget exceeded: used ${tokensUsed} tokens (limit is ${limits.maxRunTokens})`,
    };
  }

  if (costUsd >= limits.maxRunCostUsd) {
    return {
      exceeded: true,
      limitType: 'cost',
      reason: `Cost budget exceeded: incurred $${costUsd.toFixed(4)} (limit is $${limits.maxRunCostUsd.toFixed(4)})`,
    };
  }

  return { exceeded: false };
}

export function assertWithinBudget(
  tokensUsed: number,
  costUsd: number,
  limits: BudgetLimits = getBudgetLimitsFromEnv(),
): void {
  const check = checkBudget(tokensUsed, costUsd, limits);
  if (check.exceeded && check.reason && check.limitType) {
    throw new BudgetExceededError(check.reason, tokensUsed, costUsd, check.limitType);
  }
}
