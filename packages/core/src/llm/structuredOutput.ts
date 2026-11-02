import OpenAI from 'openai';
import { z } from 'zod';
import { TokenUsage } from './types.js';
import { estimateCostUsd } from './cost.js';
import { assertWithinBudget } from './budget.js';

export interface StructuredOutputOptions<T> {
  client: OpenAI;
  model: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  currentTokensUsed?: number;
  currentCostUsd?: number;
  maxRetries?: number;
  temperature?: number;
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
    maxRetries = 2,
    temperature = 0.2,
  } = options;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let accumulatedCostUsd = 0;

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
    );

    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    });

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
      if (attempt === maxAttempts) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`Structured output failed after ${maxRetries} retries: ${errorMsg}`);
      }

      const parseError = err instanceof Error ? err.message : 'Invalid JSON';
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `Your response was not valid JSON: ${parseError}. Please output valid JSON only.`,
      });
    }
  }

  throw new Error(`Structured output failed after ${maxRetries} retries.`);
}
