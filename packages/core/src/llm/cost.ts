/**
 * Estimated cost per 1M tokens (USD)
 * Pricing updated based on standard provider rates for Google AI Studio, Groq, Cerebras, Ollama, and OpenAI.
 */
interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Google AI Studio (Gemini API)
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.3 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.0 },
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-2.0-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.3 },

  // Groq
  'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79 },
  'llama-3.1-8b-instant': { inputPer1M: 0.05, outputPer1M: 0.08 },
  'mixtral-8x7b-32768': { inputPer1M: 0.24, outputPer1M: 0.24 },
  'deepseek-r1-distill-llama-70b': { inputPer1M: 0.59, outputPer1M: 0.79 },
  'gemma2-9b-it': { inputPer1M: 0.2, outputPer1M: 0.2 },

  // Cerebras
  'llama3.3-70b': { inputPer1M: 0.6, outputPer1M: 0.6 },
  'llama3.1-8b': { inputPer1M: 0.1, outputPer1M: 0.1 },
  'llama-3.3-70b': { inputPer1M: 0.6, outputPer1M: 0.6 },
  'llama-3.1-8b': { inputPer1M: 0.1, outputPer1M: 0.1 },

  // Ollama (Local free inference)
  'llama3.2': { inputPer1M: 0.0, outputPer1M: 0.0 },
  'llama3.3': { inputPer1M: 0.0, outputPer1M: 0.0 },
  'mistral': { inputPer1M: 0.0, outputPer1M: 0.0 },
  'deepseek-r1': { inputPer1M: 0.0, outputPer1M: 0.0 },
  'qwen2.5': { inputPer1M: 0.0, outputPer1M: 0.0 },

  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
  'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5 },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 0.5,
  outputPer1M: 1.5,
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const lower = model.toLowerCase();

  // Ollama or free local models
  if (
    lower.startsWith('ollama') ||
    lower.includes('llama3.2') ||
    lower.endsWith(':free') ||
    lower.includes('/free')
  ) {
    // Check if explicitly non-zero in table
    const explicit = MODEL_PRICING[lower];
    if (explicit && explicit.inputPer1M === 0 && explicit.outputPer1M === 0) {
      return 0;
    }
  }

  // 1. Exact match
  let pricing = MODEL_PRICING[lower];

  // 2. Clean prefix if any (e.g. google/gemini-2.5-flash -> gemini-2.5-flash)
  if (!pricing) {
    const stripped = lower.replace(/^(google|groq|cerebras|ollama|openai)\//, '');
    pricing = MODEL_PRICING[stripped];
  }

  // 3. Longest matching key
  if (!pricing) {
    const sortedKeys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
    const matchedKey = sortedKeys.find((key) => lower.includes(key) || key.includes(lower));
    pricing = matchedKey ? (MODEL_PRICING[matchedKey] ?? DEFAULT_PRICING) : DEFAULT_PRICING;
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;

  return Number((inputCost + outputCost).toFixed(6));
}
