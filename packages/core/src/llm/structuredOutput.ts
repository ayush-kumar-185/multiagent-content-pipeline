import OpenAI from 'openai';
import { z } from 'zod';
import { TokenUsage, BudgetLimits, AgentRole } from './types.js';
import { estimateCostUsd } from './cost.js';
import { assertWithinBudget } from './budget.js';
import {
  resolveProvider,
  normalizeModelForProvider,
  getAgentMaxTokens,
  getAgentReasoningEffort,
  roleToEnvPrefix,
} from './client.js';
import {
  recordTokenAudit,
  isTokenAuditEnabled,
  extractRateLimitHeaders,
  extractReasoningTokens,
} from './audit.js';
import { TruncatedOutputError } from './errors.js';
import { waitForPacing, updatePacingState } from './pacing.js';
import { recordDailyTokens } from './ledger.js';
import { Tracer } from '../observability/types.js';

export { TruncatedOutputError } from './errors.js';

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
  reasoningEffort?: string;
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

  let effectiveMaxTokens =
    options.maxTokens ??
    (agentRole ? getAgentMaxTokens(agentRole) : getDefaultMaxTokens(agentRole));
  let effectiveReasoningEffort =
    options.reasoningEffort ??
    (agentRole ? getAgentReasoningEffort(agentRole) : undefined) ??
    'low';

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${systemPrompt}\n\nIMPORTANT: Return valid JSON matching the requested schema. Do not include markdown code fences or conversational text outside the JSON.`,
    },
    { role: 'user', content: userPrompt },
  ];

  let truncationRetries = 0;
  const maxTruncationRetries = 1;
  let validationRetries = 0;
  const maxValidationRetries = maxRetries;
  const maxTotalAttempts = 1 + maxTruncationRetries + maxValidationRetries;

  for (let attempt = 1; attempt <= maxTotalAttempts; attempt++) {
    // 1. Budget Guard pre-check before every LLM call
    assertWithinBudget(
      currentTokensUsed + totalPromptTokens + totalCompletionTokens,
      currentCostUsd + accumulatedCostUsd,
      budgetLimits,
    );

    const callStart = Date.now();
    let completion: OpenAI.Chat.ChatCompletion;
    const responseHeaders: Record<string, string> = {};

    const createParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      temperature,
      max_tokens: effectiveMaxTokens,
      response_format: { type: 'json_object' },
      ...(effectiveReasoningEffort ? { reasoning_effort: effectiveReasoningEffort as any } : {}),
    };

    // 2. Token-aware pacing check before calling provider
    const promptEstimate = Math.ceil(JSON.stringify(messages).length / 4);
    await waitForPacing(model, promptEstimate + effectiveMaxTokens);

    try {
      if (isTokenAuditEnabled()) {
        const createPromise = client.chat.completions.create(createParams);

        if (typeof (createPromise as unknown as { withResponse?: () => Promise<{ data: OpenAI.Chat.ChatCompletion; response: { headers?: Headers | Record<string, string> } }> }).withResponse === 'function') {
          const resObj = await (createPromise as unknown as { withResponse: () => Promise<{ data: OpenAI.Chat.ChatCompletion; response: { headers?: Headers | Record<string, string> } }> }).withResponse();
          completion = resObj.data;
          Object.assign(responseHeaders, extractRateLimitHeaders(resObj.response?.headers));
        } else {
          completion = await createPromise;
          if ((completion as unknown as { headers?: unknown }).headers) {
            Object.assign(responseHeaders, extractRateLimitHeaders((completion as unknown as { headers?: unknown }).headers));
          }
        }
      } else {
        completion = await client.chat.completions.create(createParams);
      }
    } catch (apiErr: unknown) {
      const errStatus =
        (apiErr as { status?: number; statusCode?: number })?.status ??
        (apiErr as { statusCode?: number })?.statusCode ??
        undefined;

      const rawHeaders =
        (apiErr as { headers?: unknown })?.headers ??
        (apiErr as { response?: { headers?: unknown } })?.response?.headers;
      const errHeaders = extractRateLimitHeaders(rawHeaders);

      const rawErrBody =
        (apiErr as { error?: unknown })?.error ??
        (apiErr as { body?: unknown })?.body ??
        (apiErr as { response?: { data?: unknown } })?.response?.data ??
        (apiErr instanceof Error ? apiErr.message : String(apiErr));

      const errStr = (
        typeof rawErrBody === 'string'
          ? rawErrBody
          : JSON.stringify(rawErrBody) + ' ' + (apiErr instanceof Error ? apiErr.message : '')
      ).toLowerCase();

      const isTruncated =
        errStatus === 400 &&
        (errStr.includes('max completion tokens') ||
          errStr.includes('max_tokens') ||
          errStr.includes('length'));

      const errUsage =
        (apiErr as { usage?: unknown })?.usage ??
        (apiErr as { error?: { usage?: unknown } })?.error?.usage ??
        (apiErr as { response?: { data?: { usage?: unknown } } })?.response?.data?.usage;

      const promptTokensEstimate = Math.ceil(JSON.stringify(messages).length / 4);
      const errPromptTokens =
        (errUsage as { prompt_tokens?: number })?.prompt_tokens ?? promptTokensEstimate;
      const rawErrCompletionTokens =
        (errUsage as { completion_tokens?: number })?.completion_tokens ??
        (isTruncated ? effectiveMaxTokens : 0);
      const errReasoningTokens = extractReasoningTokens(errUsage);
      const errUsageObj = errUsage as { total_tokens?: number } | undefined;

      let errCompletionTokens = rawErrCompletionTokens;
      if (errUsageObj?.total_tokens && errUsageObj.total_tokens > errPromptTokens + rawErrCompletionTokens) {
        errCompletionTokens = errUsageObj.total_tokens - errPromptTokens;
      } else if (errReasoningTokens && rawErrCompletionTokens < errReasoningTokens) {
        errCompletionTokens = rawErrCompletionTokens + errReasoningTokens;
      }
      const isEstimated = !errUsage;
      const exactModelId = (apiErr as { model?: string })?.model ?? model;

      if (isTokenAuditEnabled()) {
        recordTokenAudit({
          run_id: runId ?? 'unknown',
          agent_name: agentRole ?? 'unknown',
          node_name: agentRole ?? 'unknown',
          model_id: exactModelId,
          provider,
          input_tokens: errPromptTokens,
          output_tokens: errCompletionTokens,
          reasoning_tokens: errReasoningTokens,
          finish_reason: isTruncated ? 'length' : null,
          latency_ms: Date.now() - callStart,
          attempt,
          counted_as_attempt: true,
          is_retry: attempt > 1,
          is_estimated: isEstimated,
          is_truncated: isTruncated,
          rate_limit_headers: errHeaders,
          error: {
            status: errStatus,
            body: rawErrBody,
          },
          timestamp: new Date().toISOString(),
        });
      }

      totalPromptTokens += errPromptTokens;
      totalCompletionTokens += errCompletionTokens;
      accumulatedCostUsd += estimateCostUsd(exactModelId, errPromptTokens, errCompletionTokens);

      updatePacingState(exactModelId, errHeaders);
      recordDailyTokens(exactModelId, errPromptTokens, errCompletionTokens, true);

      // Handle HTTP 400 Truncation error
      if (isTruncated) {
        if (truncationRetries >= maxTruncationRetries) {
          throw new TruncatedOutputError(
            `Output was truncated due to token limit after ${truncationRetries} retry (max_tokens: ${effectiveMaxTokens}). Failed to complete valid JSON: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`,
            {
              status: 400,
              finishReason: 'length',
              attemptedMaxTokens: effectiveMaxTokens,
            },
          );
        }

        truncationRetries++;
        const rolePrefix = agentRole ? roleToEnvPrefix(agentRole) : '';
        const envCap = Number(
          (rolePrefix ? process.env[`${rolePrefix}_MAX_TRUNCATION_TOKENS`] : undefined) ??
            process.env.MAX_TRUNCATION_TOKENS ??
            4000,
        );
        const increased = Math.max(Math.round(effectiveMaxTokens * 1.5), effectiveMaxTokens + 500);
        effectiveMaxTokens = Math.min(increased, envCap);
        effectiveReasoningEffort =
          options.reasoningEffort ?? (agentRole ? getAgentReasoningEffort(agentRole) : undefined) ?? 'low';

        // Requirement 2: Do NOT resend full prompt unchanged; do NOT append invalid assistant content
        messages[1] = {
          role: 'user',
          content: `${userPrompt}\n\n[CRITICAL: Generation truncated at previous max_tokens limit. Be concise and output ONLY the complete valid JSON object conforming to the schema.]`,
        };
        continue;
      }

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
    const isEstimated = !usage || (usage.prompt_tokens === 0 && usage.completion_tokens === 0);
    const promptTokens = usage?.prompt_tokens ?? Math.ceil(JSON.stringify(messages).length / 4);
    const rawCompletionTokens = usage?.completion_tokens ?? Math.ceil((completion.choices[0]?.message?.content ?? '').length / 4);
    const finishReason = completion.choices[0]?.finish_reason ?? null;
    const isTruncated = finishReason === 'length' || (finishReason as string) === 'max_tokens';
    const reasoningTokens = extractReasoningTokens(usage);
    const exactModelId = completion.model || model;

    let completionTokens = rawCompletionTokens;
    if (usage?.total_tokens && usage.total_tokens > promptTokens + rawCompletionTokens) {
      completionTokens = usage.total_tokens - promptTokens;
    } else if (reasoningTokens && rawCompletionTokens < reasoningTokens) {
      completionTokens = rawCompletionTokens + reasoningTokens;
    }

    if (isTokenAuditEnabled()) {
      recordTokenAudit({
        run_id: runId ?? 'unknown',
        agent_name: agentRole ?? 'unknown',
        node_name: agentRole ?? 'unknown',
        model_id: exactModelId,
        provider,
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        reasoning_tokens: reasoningTokens,
        finish_reason: finishReason,
        latency_ms: latencyMs,
        attempt,
        counted_as_attempt: true,
        is_retry: attempt > 1,
        is_estimated: isEstimated,
        is_truncated: isTruncated,
        rate_limit_headers: responseHeaders,
        timestamp: new Date().toISOString(),
      });
    }

    totalPromptTokens += promptTokens;
    totalCompletionTokens += completionTokens;

    const callCost = estimateCostUsd(exactModelId, promptTokens, completionTokens);
    accumulatedCostUsd += callCost;

    updatePacingState(exactModelId, responseHeaders);
    recordDailyTokens(exactModelId, promptTokens, completionTokens, false);

    const content = completion.choices[0]?.message?.content ?? '';

    // Handle 200 Truncation (finish_reason === 'length')
    if (isTruncated) {
      if (tracer && runId) {
        tracer.recordLLMCall(runId, {
          agentRole: agentRole ?? 'writer',
          model: exactModelId,
          messages,
          output: content,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          costUsd: callCost,
          latencyMs,
          attempt,
          success: false,
          error: `Output was truncated (finish_reason: ${finishReason})`,
        });
      }

      if (truncationRetries >= maxTruncationRetries) {
        throw new TruncatedOutputError(
          `Output was truncated due to token limit after ${truncationRetries} retry (max_tokens: ${effectiveMaxTokens}). Failed to complete valid JSON.`,
          {
            finishReason,
            attemptedMaxTokens: effectiveMaxTokens,
            rawOutput: content,
          },
        );
      }

      truncationRetries++;
      const rolePrefix = agentRole ? roleToEnvPrefix(agentRole) : '';
      const envCap = Number(
        (rolePrefix ? process.env[`${rolePrefix}_MAX_TRUNCATION_TOKENS`] : undefined) ??
          process.env.MAX_TRUNCATION_TOKENS ??
          4000,
      );
      const increased = Math.max(Math.round(effectiveMaxTokens * 1.5), effectiveMaxTokens + 500);
      effectiveMaxTokens = Math.min(increased, envCap);
      effectiveReasoningEffort = 'low';

      // Requirement 2: Do NOT resend full prompt unchanged; do NOT append invalid assistant content
      messages[1] = {
        role: 'user',
        content: `${userPrompt}\n\n[CRITICAL: Generation truncated at previous max_tokens limit. Be concise and output ONLY the complete valid JSON object conforming to the schema.]`,
      };
      continue;
    }

    // Parse and validate JSON
    let parsedRaw: unknown;
    try {
      const cleanJson = extractJson(content);
      parsedRaw = JSON.parse(cleanJson);
    } catch (parseErr: unknown) {
      if (tracer && runId) {
        const errorMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        tracer.recordLLMCall(runId, {
          agentRole: agentRole ?? 'writer',
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
          error: `JSON parse error: ${errorMsg}`,
        });
      }

      if (validationRetries >= maxValidationRetries) {
        throw new Error(
          `Structured output failed after ${validationRetries} retries: Invalid JSON format (${parseErr instanceof Error ? parseErr.message : String(parseErr)})`,
        );
      }

      validationRetries++;
      // On parse failure: append ONLY the parse error to user prompt, NOT the invalid assistant response
      messages[1] = {
        role: 'user',
        content: `${userPrompt}\n\n[Previous attempt was not valid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Please output ONLY valid JSON conforming to the schema.]`,
      };
      continue;
    }

    const validation = schema.safeParse(parsedRaw);
    if (validation.success) {
      if (tracer && runId) {
        tracer.recordLLMCall(runId, {
          agentRole: agentRole ?? 'writer',
          model: exactModelId,
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
        agentRole: agentRole ?? 'writer',
        model: exactModelId,
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

    if (validationRetries >= maxValidationRetries) {
      throw new Error(
        `Output failed Zod schema validation after ${validationRetries} retries: ${errorDetails}`,
      );
    }

    validationRetries++;
    // Requirement 3: On Zod validation failure, append ONLY the list of validation errors,
    // NOT the entire previous invalid response and NOT a duplicate of the whole prompt history.
    messages[1] = {
      role: 'user',
      content: `${userPrompt}\n\n[Previous attempt failed schema validation with errors: ${errorDetails}. Please fix these issues and output ONLY valid JSON conforming to the schema.]`,
    };
  }

  throw new Error(`Structured output failed after retries.`);
}
