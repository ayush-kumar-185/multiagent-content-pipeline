import OpenAI from 'openai';
import { z } from 'zod';
import { TokenUsage, BudgetLimits, AgentRole } from './types.js';
import { estimateCostUsd } from './cost.js';
import { assertWithinBudget } from './budget.js';
import { resolveProvider, normalizeModelForProvider } from './client.js';
import { Tracer } from '../observability/types.js';

export interface StructuredOutputOptions<T> {
  client: OpenAI;
  model: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  currentTokensUsed?: number;
  currentCostUsd?: number;
  budgetLimits?: BudgetLimits;
  runId?: string;
  agentRole?: AgentRole;
  provider?: import('./types.js').LLMProvider;
  tracer?: Tracer;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredOutputResult<T> {
  data: T;
  tokens: TokenUsage;
  costUsd: number;
  attempts: number;
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Strip markdown code fences if present (e.g. ```json ... ``` or ``` ...)
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function getDefaultMaxTokens(role?: AgentRole): number {
  switch (role) {
    case 'editor':
      return 1000;
    case 'factChecker':
      return 2000;
    case 'researcher':
      return 3500;
    case 'writer':
    default:
      return 2500;
  }
}

export async function generateStructuredOutput<T>(
  options: StructuredOutputOptions<T>,
): Promise<StructuredOutputResult<T>> {
  const {
    client,
    model: rawModel,
    schema,
    systemPrompt,
    userPrompt,
    currentTokensUsed = 0,
    currentCostUsd = 0,
    budgetLimits,
    runId,
    agentRole,
    provider: explicitProvider,
    tracer,
    maxRetries = 2,
    temperature = 0.2,
  } = options;

  const provider =
    explicitProvider ??
    resolveProvider({
      provider: explicitProvider,
      role: agentRole,
      model: rawModel,
    });
  const model = normalizeModelForProvider(rawModel, provider);

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let accumulatedCostUsd = 0;

  let effectiveMaxTokens = options.maxTokens ?? getDefaultMaxTokens(agentRole);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${systemPrompt}\n\nIMPORTANT: Return valid JSON matching the requested schema. Do not include markdown code fences or conversational text outside the JSON.`,
    },
    { role: 'user', content: userPrompt },
  ];

  const maxAttempts = maxRetries + 1; // e.g. 2 retries = 3 attempts total

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1. Budget Guard pre-check before every LLM call
    assertWithinBudget(
      currentTokensUsed + totalPromptTokens + totalCompletionTokens,
      currentCostUsd + accumulatedCostUsd,
      budgetLimits,
    );

    const callStart = Date.now();
    let completion: OpenAI.Chat.ChatCompletion;

    try {
      completion = await client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: effectiveMaxTokens,
        response_format: { type: 'json_object' },
      });
    } catch (apiErr: unknown) {
      const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      const status = (apiErr as { status?: number })?.status;

      if (
        status === 401 ||
        errMsg.toLowerCase().includes('unauthorized') ||
        errMsg.toLowerCase().includes('invalid api key') ||
        errMsg.toLowerCase().includes('api_key_invalid')
      ) {
        throw new Error(
          `Authentication failed for provider "${provider.toUpperCase()}" with model "${model}". Please verify that your API key is correctly set in .env. Details: ${errMsg}`,
        );
      }

      if (
        status === 429 ||
        errMsg.toLowerCase().includes('rate limit') ||
        errMsg.toLowerCase().includes('resource_exhausted') ||
        errMsg.toLowerCase().includes('quota')
      ) {
        throw new Error(
          `Rate limit or quota exceeded for provider "${provider.toUpperCase()}" with model "${model}". Please check your platform quota or wait before retrying. Details: ${errMsg}`,
        );
      }

      if (errMsg.includes('ECONNREFUSED')) {
        throw new Error(
          `Connection refused while contacting provider "${provider.toUpperCase()}". If using Ollama, make sure the Ollama daemon is running ('ollama serve'). Details: ${errMsg}`,
        );
      }

      throw apiErr;
    }

    const latencyMs = Date.now() - callStart;

    const usage = completion.usage;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    totalPromptTokens += promptTokens;
    totalCompletionTokens += completionTokens;

    const callCost = estimateCostUsd(model, promptTokens, completionTokens);
    accumulatedCostUsd += callCost;

    const content = completion.choices[0]?.message?.content ?? '';

    try {
      const cleanJson = extractJson(content);
      const parsedRaw = JSON.parse(cleanJson);
      const validation = schema.safeParse(parsedRaw);

      if (validation.success) {
        if (tracer && runId) {
          tracer.recordLLMCall(runId, {
            agentRole,
            model,
            messages,
            output: validation.data,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            costUsd: callCost,
            latencyMs,
            attempt,
            success: true,
          });
        }

        return {
          data: validation.data,
          tokens: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
          costUsd: Number(accumulatedCostUsd.toFixed(6)),
          attempts: attempt,
        };
      }

      // Schema validation failed
      const errorDetails = validation.error.issues
        .map((issue) => `Field "${issue.path.join('.')}": ${issue.message}`)
        .join('; ');

      if (tracer && runId) {
        tracer.recordLLMCall(runId, {
          agentRole,
          model,
          messages,
          output: content,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          costUsd: callCost,
          latencyMs,
          attempt,
          success: false,
          error: errorDetails,
        });
      }

      if (attempt === maxAttempts) {
        throw new Error(
          `Output failed Zod schema validation after ${maxRetries} retries: ${errorDetails}`,
        );
      }

      // Append assistant's invalid response and user's correction prompt
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `Your previous JSON output failed validation with the following errors:\n${errorDetails}\n\nPlease fix the issues and output ONLY the corrected JSON conforming to the schema.`,
      });
    } catch (err: unknown) {
      if (tracer && runId) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        tracer.recordLLMCall(runId, {
          agentRole,
          model,
          messages,
          output: content,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          costUsd: callCost,
          latencyMs,
          attempt,
          success: false,
          error: errorMsg,
        });
      }

      if (attempt === maxAttempts) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`Structured output failed after ${maxRetries} retries: ${errorMsg}`);
      }

      const parseError = err instanceof Error ? err.message : 'Invalid JSON';
      if (completion.choices[0]?.finish_reason === 'length') {
        effectiveMaxTokens = Math.min(8000, Math.floor(effectiveMaxTokens * 1.5));
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `Your previous response was truncated because it exceeded the output token limit. Please output concise, complete, valid JSON only.`,
        });
      } else {
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `Your response was not valid JSON: ${parseError}. Please output valid JSON only.`,
        });
      }
    }
  }

  throw new Error(`Structured output failed after ${maxRetries} retries.`);
}
