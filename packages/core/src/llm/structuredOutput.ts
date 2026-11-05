import OpenAI from 'openai';
import { z } from 'zod';
import { TokenUsage, BudgetLimits } from './types.js';
import { estimateCostUsd } from './cost.js';
import { assertWithinBudget } from './budget.js';
import { AgentRole } from './client.js';
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
    model,
    schema,
    systemPrompt,
    userPrompt,
    currentTokensUsed = 0,
    currentCostUsd = 0,
    budgetLimits,
    runId,
    agentRole = 'writer',
    tracer,
    maxRetries = 2,
    temperature = 0.2,
  } = options;

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
      const is402 = (apiErr as { status?: number })?.status === 402 || errMsg.includes('402');
      const affordMatch = errMsg.match(/can only afford (\d+)/i);

      if (is402 && affordMatch && affordMatch[1]) {
        const affordable = parseInt(affordMatch[1], 10);
        if (affordable >= 150 && effectiveMaxTokens > affordable) {
          effectiveMaxTokens = Math.max(100, Math.floor(affordable * 0.95));
          console.warn(
            `[AdaptiveTokenClamping] OpenRouter credit limit reached for model "${model}". Dynamically clamping max_tokens to ${effectiveMaxTokens} affordable tokens and retrying.`,
          );
          try {
            completion = await client.chat.completions.create({
              model,
              messages,
              temperature,
              max_tokens: effectiveMaxTokens,
              response_format: { type: 'json_object' },
            });
          } catch (retryErr: unknown) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            throw new Error(
              `OpenRouter credit limit exceeded for model "${model}". Key can only afford ${affordable} tokens. Please add credits or switch to a lighter model like openai/gpt-4o-mini in .env. Details: ${retryMsg}`,
            );
          }
        } else {
          throw new Error(
            `OpenRouter credit limit exceeded for model "${model}". Key can only afford ${affordable} tokens (minimum required: 150). Please add credits to your OpenRouter account or switch to a lighter model like openai/gpt-4o-mini in .env.`,
          );
        }
      } else {
        throw apiErr;
      }
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
