export interface LLMCallTrace {
  id?: string;
  agentRole: string;
  model: string;
  messages: unknown[];
  output: unknown;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  attempt: number;
  success: boolean;
  error?: string;
}

export interface ToolCallTrace {
  id?: string;
  agentRole: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface AgentMetricSummary {
  tokensUsed: number;
  costUsd: number;
  calls: number;
}

export interface RunTraceSummary {
  runId: string;
  topic?: string;
  totalTokens: number;
  totalCostUsd: number;
  totalLLMCalls: number;
  totalToolCalls: number;
  agentMetrics: Record<string, AgentMetricSummary>;
  llmCalls: LLMCallTrace[];
  toolCalls: ToolCallTrace[];
}

export interface TracerOptions {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
  enabled?: boolean;
}

export interface Tracer {
  startRunTrace(
    runId: string,
    metadata?: { topic?: string; config?: unknown; userId?: string },
  ): void;
  startAgentSpan(runId: string, agentRole: string, input?: unknown): void;
  endAgentSpan(runId: string, agentRole: string, output?: unknown): void;
  recordLLMCall(runId: string, trace: LLMCallTrace): void;
  recordToolCall(runId: string, trace: ToolCallTrace): void;
  getTraceSummary(runId: string): RunTraceSummary | undefined;
  getAllSummaries(): Map<string, RunTraceSummary>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
