/**
 * Estimated cost per 1M tokens (USD)
 * Pricing updated based on standard provider rates.
 */
interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
  'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5 },

  // Anthropic / Claude (via OpenRouter or direct)
  'claude-3-5-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'anthropic/claude-3.5-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  'anthropic/claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },

  // OpenRouter generic routing
  'openai/gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'openai/gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 2.5,
  outputPer1M: 10.0,
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const lower = model.toLowerCase();

  // Free models (OpenRouter free router or :free models)
  if (lower.endsWith(':free') || lower === 'openrouter/free' || lower.includes('/free')) {
    return 0;
  }

  // 1. Exact match
  let pricing = MODEL_PRICING[lower];

  // 2. Longest matching key (so 'gpt-4o-mini' matches before 'gpt-4o')
  if (!pricing) {
    const sortedKeys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
    const matchedKey = sortedKeys.find((key) => lower.includes(key) || key.includes(lower));
    pricing = matchedKey ? (MODEL_PRICING[matchedKey] ?? DEFAULT_PRICING) : DEFAULT_PRICING;
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;

  return Number((inputCost + outputCost).toFixed(6));
}
