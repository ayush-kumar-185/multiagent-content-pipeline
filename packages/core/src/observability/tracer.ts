import { Langfuse } from 'langfuse';
import {
  Tracer,
  TracerOptions,
  LLMCallTrace,
  ToolCallTrace,
  RunTraceSummary,
  AgentMetricSummary,
} from './types.js';

export class CiteWriterTracer implements Tracer {
  private langfuse?: Langfuse;
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
      process.env.LANGFUSE_HOST ??
      process.env.LANGFUSE_BASE_URL ??
      'https://cloud.langfuse.com';

    this.enabled =
      options.enabled !== undefined ? options.enabled : Boolean(publicKey && secretKey);

    if (this.enabled && publicKey && secretKey) {
      try {
        this.langfuse = new Langfuse({
          publicKey,
          secretKey,
          baseUrl,
        });
      } catch (err) {
        console.warn('Failed to initialize Langfuse client:', err);
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled && Boolean(this.langfuse);
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

    if (this.langfuse) {
      try {
        const trace = this.langfuse.trace({
          id: runId,
          name: 'citewriter-run',
          userId: metadata?.userId,
          metadata: {
            topic: metadata?.topic,
            config: metadata?.config,
          },
          input: {
            topic: metadata?.topic,
          },
        });
        this.activeTraces.set(runId, trace);
      } catch (err) {
        console.warn(`[Tracer] Failed to create Langfuse trace for ${runId}:`, err);
      }
    }
  }

  public startAgentSpan(runId: string, agentRole: string, input?: unknown): void {
    const spanKey = `${runId}:${agentRole}`;
    const trace = this.activeTraces.get(runId);

    if (trace) {
      try {
        const span = trace.span({
          name: `agent:${agentRole}`,
          input,
          startTime: new Date(),
        });
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
        span.end({
          output,
          endTime: new Date(),
        });
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

    // 2. Langfuse generation update
    const spanKey = `${runId}:${trace.agentRole}`;
    const parentSpan = this.activeSpans.get(spanKey);
    const parentTrace = this.activeTraces.get(runId);
    const context = parentSpan ?? parentTrace;

    if (context) {
      try {
        context.generation({
          name: `${trace.agentRole}:llm`,
          model: trace.model,
          input: trace.messages,
          output: trace.output,
          usage: {
            promptTokens: trace.promptTokens,
            completionTokens: trace.completionTokens,
            totalTokens: trace.totalTokens,
          },
          metadata: {
            costUsd: trace.costUsd,
            latencyMs: trace.latencyMs,
            attempt: trace.attempt,
            success: trace.success,
            error: trace.error,
          },
        });
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

    // 2. Langfuse tool span
    const spanKey = `${runId}:${trace.agentRole}`;
    const parentSpan = this.activeSpans.get(spanKey);
    const parentTrace = this.activeTraces.get(runId);
    const context = parentSpan ?? parentTrace;

    if (context) {
      try {
        const toolSpan = context.span({
          name: `tool:${trace.toolName}`,
          input: trace.input,
          output: trace.output,
          level: trace.success ? 'DEFAULT' : 'ERROR',
          statusMessage: trace.error,
          metadata: {
            latencyMs: trace.latencyMs,
          },
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
    if (this.langfuse) {
      try {
        await this.langfuse.flushAsync();
      } catch (err) {
        console.warn('[Tracer] Error flushing Langfuse events:', err);
      }
    }
  }

  public async shutdown(): Promise<void> {
    if (this.langfuse) {
      try {
        await this.langfuse.shutdownAsync();
      } catch (err) {
        console.warn('[Tracer] Error shutting down Langfuse:', err);
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
