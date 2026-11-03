import { describe, it, expect, beforeEach } from 'vitest';
import { CiteWriterTracer, resetGlobalTracer } from './tracer.js';

describe('CiteWriter Observability & Tracing', () => {
  beforeEach(() => {
    resetGlobalTracer();
  });

  it('initializes in-memory run trace and collects metadata', () => {
    const tracer = new CiteWriterTracer({ enabled: false });
    const runId = 'test-run-1';

    tracer.startRunTrace(runId, {
      topic: 'Vector Databases in TypeScript',
      config: { audience: 'experts', targetWords: 1000 },
      userId: 'user-123',
    });

    const summary = tracer.getTraceSummary(runId);
    expect(summary).toBeDefined();
    expect(summary?.runId).toBe(runId);
    expect(summary?.topic).toBe('Vector Databases in TypeScript');
    expect(summary?.totalTokens).toBe(0);
    expect(summary?.totalCostUsd).toBe(0);
    expect(summary?.totalLLMCalls).toBe(0);
    expect(summary?.totalToolCalls).toBe(0);
  });

  it('records LLM calls and aggregates tokens and cost per agent', () => {
    const tracer = new CiteWriterTracer({ enabled: false });
    const runId = 'test-run-2';
    tracer.startRunTrace(runId, { topic: 'Testing LLM Observability' });

    tracer.startAgentSpan(runId, 'researcher');
    tracer.recordLLMCall(runId, {
      agentRole: 'researcher',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'find notes' }],
      output: { notes: [] },
      promptTokens: 400,
      completionTokens: 100,
      totalTokens: 500,
      costUsd: 0.000375,
      latencyMs: 320,
      attempt: 1,
      success: true,
    });
    tracer.endAgentSpan(runId, 'researcher');

    tracer.startAgentSpan(runId, 'writer');
    tracer.recordLLMCall(runId, {
      agentRole: 'writer',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'write draft' }],
      output: { draft: 'sample text' },
      promptTokens: 800,
      completionTokens: 400,
      totalTokens: 1200,
      costUsd: 0.0125,
      latencyMs: 780,
      attempt: 1,
      success: true,
    });
    tracer.endAgentSpan(runId, 'writer');

    const summary = tracer.getTraceSummary(runId);
    expect(summary).toBeDefined();
    expect(summary?.totalTokens).toBe(1700); // 500 + 1200
    expect(summary?.totalCostUsd).toBeCloseTo(0.012875, 5);
    expect(summary?.totalLLMCalls).toBe(2);

    // Verify per-agent breakdown
    expect(summary?.agentMetrics['researcher']).toEqual({
      tokensUsed: 500,
      costUsd: 0.000375,
      calls: 1,
    });
    expect(summary?.agentMetrics['writer']).toEqual({
      tokensUsed: 1200,
      costUsd: 0.0125,
      calls: 1,
    });
  });

  it('records tool calls (web_search, fetch_page) with latency and status', () => {
    const tracer = new CiteWriterTracer({ enabled: false });
    const runId = 'test-run-3';
    tracer.startRunTrace(runId, { topic: 'Testing Tool Observability' });

    tracer.recordToolCall(runId, {
      agentRole: 'researcher',
      toolName: 'web_search',
      input: { query: 'TypeScript 5 features' },
      output: { resultsCount: 4 },
      latencyMs: 145,
      success: true,
    });

    tracer.recordToolCall(runId, {
      agentRole: 'researcher',
      toolName: 'fetch_page',
      input: { url: 'https://example.com/docs' },
      output: { length: 2500 },
      latencyMs: 230,
      success: true,
    });

    tracer.recordToolCall(runId, {
      agentRole: 'factChecker',
      toolName: 'fetch_page',
      input: { url: 'https://malicious-internal.invalid' },
      latencyMs: 12,
      success: false,
      error: 'SSRF blocked',
    });

    const summary = tracer.getTraceSummary(runId);
    expect(summary).toBeDefined();
    expect(summary?.totalToolCalls).toBe(3);
    expect(summary?.toolCalls).toHaveLength(3);
    expect(summary?.toolCalls[0]?.toolName).toBe('web_search');
    expect(summary?.toolCalls[2]?.success).toBe(false);
    expect(summary?.toolCalls[2]?.error).toBe('SSRF blocked');
  });

  it('flush and shutdown execute gracefully without throwing', async () => {
    const tracer = new CiteWriterTracer({ enabled: false });
    tracer.startRunTrace('run-4', { topic: 'Graceful flush' });
    await expect(tracer.flush()).resolves.not.toThrow();
    await expect(tracer.shutdown()).resolves.not.toThrow();
  });
});
