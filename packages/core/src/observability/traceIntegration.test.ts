import { describe, it, expect } from 'vitest';
import { createCiteWriterGraph } from '../graph/builder.js';
import { CiteWriterTracer } from './tracer.js';
import { GraphState } from '../schemas/state.js';

describe('Observability Integration: Trace Totals Match Graph State', () => {
  it('ensures a single run trace records each agent call and the traced cost/tokens match state totals', async () => {
    const tracer = new CiteWriterTracer({ enabled: false });
    const runId = 'obs-test-run-101';
    const topic = 'Event-Driven Architectures in TypeScript';

    tracer.startRunTrace(runId, {
      topic,
      config: { audience: 'software engineers', tone: 'technical', targetWords: 600 },
      userId: 'test-user-obs',
    });

    const app = createCiteWriterGraph({
      tracer,
    });

    const threadConfig = { configurable: { thread_id: runId } };
    await app.invoke(
      {
        runId,
        topic,
        config: { audience: 'software engineers', tone: 'technical', targetWords: 600 },
      },
      threadConfig,
    );

    const snapshot = await app.getState(threadConfig);
    const finalState = snapshot.values as GraphState;

    expect(finalState).toBeDefined();
    expect(finalState.status).toBe('awaiting_review');

    // Fetch tracer summary
    const summary = tracer.getTraceSummary(runId);
    expect(summary).toBeDefined();

    // Verify per-agent metrics exist and are recorded in graph state
    expect(finalState?.agentMetrics).toBeDefined();
    expect(finalState?.agentMetrics['researcher']).toBeDefined();
    expect(finalState?.agentMetrics['writer']).toBeDefined();
    expect(finalState?.agentMetrics['factChecker']).toBeDefined();
    expect(finalState?.agentMetrics['editor']).toBeDefined();

    // Sum up tokens and cost across all agent metrics
    let accumulatedTokens = 0;
    let accumulatedCost = 0;
    for (const metrics of Object.values(finalState!.agentMetrics)) {
      accumulatedTokens += metrics.tokensUsed;
      accumulatedCost += metrics.costUsd;
    }

    // Cost and token totals in state match sum of agent metrics
    expect(finalState?.tokensUsed).toBe(accumulatedTokens);
    expect(finalState?.costUsd).toBeCloseTo(accumulatedCost, 4);

    // Verify each agent had calls recorded
    expect(finalState?.agentMetrics['researcher']?.calls).toBeGreaterThanOrEqual(1);
    expect(finalState?.agentMetrics['writer']?.calls).toBeGreaterThanOrEqual(1);
    expect(finalState?.agentMetrics['factChecker']?.calls).toBeGreaterThanOrEqual(1);
    expect(finalState?.agentMetrics['editor']?.calls).toBeGreaterThanOrEqual(1);
  });
});
