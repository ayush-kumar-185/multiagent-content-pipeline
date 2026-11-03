import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { startObservation } from '@langfuse/tracing';
import {
  Tracer,
  TracerOptions,
  LLMCallTrace,
  ToolCallTrace,
  RunTraceSummary,
  AgentMetricSummary,
} from './types.js';

export class CiteWriterTracer implements Tracer {
  private sdk?: NodeSDK;
  private processor?: LangfuseSpanProcessor;
  private readonly enabled: boolean;
  private readonly summaries = new Map<string, RunTraceSummary>();
  // Store active Langfuse traces and spans
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly activeTraces = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly activeSpans = new Map<string, any>();

  constructor(options: TracerOptions = {}) {
    const publicKey = options.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = options.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
    const baseUrl =
      options.baseUrl ??
      process.env.LANGFUSE_BASEURL ??
      process.env.LANGFUSE_BASE_URL ??
      process.env.LANGFUSE_HOST ??
      'https://cloud.langfuse.com';

    const enabledEnv = process.env.LANGFUSE_ENABLED;
    const isExplicitlyDisabled = enabledEnv === 'false' || enabledEnv === '0';

    this.enabled =
      !isExplicitlyDisabled &&
      (options.enabled !== undefined ? options.enabled : Boolean(publicKey && secretKey));

    if (this.enabled && publicKey && secretKey) {
      try {
        process.env.LANGFUSE_PUBLIC_KEY = publicKey;
        process.env.LANGFUSE_SECRET_KEY = secretKey;
        process.env.LANGFUSE_BASE_URL = baseUrl;
        process.env.LANGFUSE_BASEURL = baseUrl;

        this.processor = new LangfuseSpanProcessor();
        this.sdk = new NodeSDK({
          spanProcessors: [this.processor],
        });
        this.sdk.start();
      } catch (err) {
        console.warn('Failed to initialize Langfuse OpenTelemetry client:', err);
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled && Boolean(this.processor);
  }

  public startRunTrace(
    runId: string,
    metadata?: { topic?: string; config?: unknown; userId?: string },
  ): void {
    if (!this.summaries.has(runId)) {
      this.summaries.set(runId, {
        runId,
        topic: metadata?.topic,
        totalTokens: 0,
        totalCostUsd: 0,
        totalLLMCalls: 0,
        totalToolCalls: 0,
        agentMetrics: {},
        llmCalls: [],
        toolCalls: [],
      });
    }

    if (this.processor) {
      try {
        const trace = startObservation(
          'citewriter-run',
          {
            input: { topic: metadata?.topic },
            metadata: {
              runId,
              topic: metadata?.topic,
              config: metadata?.config,
              userId: metadata?.userId,
            },
          },
          { asType: 'span' },
        );
        this.activeTraces.set(runId, trace);
      } catch (err) {
        console.warn(`[Tracer] Failed to create Langfuse trace for ${runId}:`, err);
      }
    }
  }

  public startAgentSpan(runId: string, agentRole: string, input?: unknown): void {
    const spanKey = `${runId}:${agentRole}`;
    if (this.processor) {
      try {
        const span = startObservation(
          `agent:${agentRole}`,
          {
            input,
            metadata: { runId, agentRole },
          },
          { asType: 'agent' },
        );
        this.activeSpans.set(spanKey, span);
      } catch (err) {
        console.warn(`[Tracer] Failed to start span for ${spanKey}:`, err);
      }
    }
  }

  public endAgentSpan(runId: string, agentRole: string, output?: unknown): void {
    const spanKey = `${runId}:${agentRole}`;
    const span = this.activeSpans.get(spanKey);

    if (span) {
      try {
        span.update({ output });
        span.end();
        this.activeSpans.delete(spanKey);
      } catch (err) {
        console.warn(`[Tracer] Failed to end span for ${spanKey}:`, err);
      }
    }
  }

  public recordLLMCall(runId: string, trace: LLMCallTrace): void {
    // 1. In-memory summary update
    let summary = this.summaries.get(runId);
    if (!summary) {
      summary = {
        runId,
        totalTokens: 0,
        totalCostUsd: 0,
        totalLLMCalls: 0,
        totalToolCalls: 0,
        agentMetrics: {},
        llmCalls: [],
        toolCalls: [],
      };
      this.summaries.set(runId, summary);
    }

    summary.totalTokens += trace.totalTokens;
    summary.totalCostUsd = Number((summary.totalCostUsd + trace.costUsd).toFixed(6));
    summary.totalLLMCalls += 1;
    summary.llmCalls.push(trace);

    // Update per-agent metrics
    const prevMetrics: AgentMetricSummary = summary.agentMetrics[trace.agentRole] ?? {
      tokensUsed: 0,
      costUsd: 0,
      calls: 0,
    };
    summary.agentMetrics[trace.agentRole] = {
      tokensUsed: prevMetrics.tokensUsed + trace.totalTokens,
      costUsd: Number((prevMetrics.costUsd + trace.costUsd).toFixed(6)),
      calls: prevMetrics.calls + 1,
    };

    // 2. Langfuse OpenTelemetry generation span
    if (this.processor) {
      try {
        const gen = startObservation(
          `${trace.agentRole}:llm`,
          {
            model: trace.model,
            input: trace.messages,
            metadata: {
              runId,
              agentRole: trace.agentRole,
              latencyMs: trace.latencyMs,
              attempt: trace.attempt,
              success: trace.success,
              error: trace.error,
            },
          },
          { asType: 'generation' },
        );

        gen.update({
          output: trace.output,
          usageDetails: {
            promptTokens: trace.promptTokens,
            completionTokens: trace.completionTokens,
            totalTokens: trace.totalTokens,
          },
          costDetails: {
            total: trace.costUsd,
          },
          level: trace.success ? 'DEFAULT' : 'ERROR',
          statusMessage: trace.error,
        });
        gen.end();
      } catch (err) {
        console.warn(`[Tracer] Failed to record generation for ${runId}:`, err);
      }
    }
  }

  public recordToolCall(runId: string, trace: ToolCallTrace): void {
    // 1. In-memory summary update
    let summary = this.summaries.get(runId);
    if (!summary) {
      summary = {
        runId,
        totalTokens: 0,
        totalCostUsd: 0,
        totalLLMCalls: 0,
        totalToolCalls: 0,
        agentMetrics: {},
        llmCalls: [],
        toolCalls: [],
      };
      this.summaries.set(runId, summary);
    }

    summary.totalToolCalls += 1;
    summary.toolCalls.push(trace);

    // 2. Langfuse OpenTelemetry tool span
    if (this.processor) {
      try {
        const toolSpan = startObservation(
          `tool:${trace.toolName}`,
          {
            input: trace.input,
            metadata: {
              runId,
              agentRole: trace.agentRole,
              latencyMs: trace.latencyMs,
            },
          },
          { asType: 'tool' },
        );

        toolSpan.update({
          output: trace.output,
          level: trace.success ? 'DEFAULT' : 'ERROR',
          statusMessage: trace.error,
        });
        toolSpan.end();
      } catch (err) {
        console.warn(`[Tracer] Failed to record tool call for ${runId}:`, err);
      }
    }
  }

  public getTraceSummary(runId: string): RunTraceSummary | undefined {
    return this.summaries.get(runId);
  }

  public getAllSummaries(): Map<string, RunTraceSummary> {
    return new Map(this.summaries);
  }

  public async flush(): Promise<void> {
    for (const [runId, trace] of this.activeTraces.entries()) {
      try {
        trace.end();
      } catch {
        // ignore
      }
      this.activeTraces.delete(runId);
    }

    if (this.processor) {
      try {
        await this.processor.forceFlush();
      } catch (err) {
        console.warn('[Tracer] Error flushing Langfuse OpenTelemetry events:', err);
      }
    }
  }

  public async shutdown(): Promise<void> {
    for (const [runId, trace] of this.activeTraces.entries()) {
      try {
        trace.end();
      } catch {
        // ignore
      }
      this.activeTraces.delete(runId);
    }

    if (this.sdk) {
      try {
        await this.sdk.shutdown();
      } catch (err) {
        console.warn('[Tracer] Error shutting down Langfuse OpenTelemetry SDK:', err);
      }
    }
  }
}

// Global default singleton tracer
let globalTracer: CiteWriterTracer | undefined;

export function getTracer(options?: TracerOptions): CiteWriterTracer {
  if (!globalTracer || options) {
    globalTracer = new CiteWriterTracer(options);
  }
  return globalTracer;
}

export function resetGlobalTracer(): void {
  globalTracer = undefined;
}
