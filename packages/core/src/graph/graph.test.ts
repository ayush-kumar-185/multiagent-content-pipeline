import { describe, it, expect } from 'vitest';
import { Command } from '@langchain/langgraph';
import { createCiteWriterGraph } from './builder.js';

describe('CiteWriter Graph Integration Tests', () => {
  it('Clean Path: runs from START to humanReview, pauses, and resumes with approve', async () => {
    const app = createCiteWriterGraph();
    const threadConfig = { configurable: { thread_id: 'test-clean-approve' } };

    // 1. Initial invocation (should pause at humanReview)
    await app.invoke(
      {
        runId: 'run-clean-1',
        topic: 'TypeScript 5.0 Features',
        config: { audience: 'developers', tone: 'technical', targetWords: 500 },
      },
      threadConfig,
    );

    // Verify state paused at human review
    const stateBeforeResume = await app.getState(threadConfig);
    expect(stateBeforeResume.next).toEqual(['humanReview']);
    expect(stateBeforeResume.values.status).toBe('awaiting_review');
    expect(stateBeforeResume.values.notes.length).toBeGreaterThan(0);
    expect(stateBeforeResume.values.claims.length).toBeGreaterThan(0);
    expect(stateBeforeResume.values.researchRounds).toBe(1);
    expect(stateBeforeResume.values.writeCycles).toBe(1);
    expect(stateBeforeResume.values.openIssues).toEqual([]);

    // 2. Resume with approve
    const resumeResult = await app.invoke(
      new Command({
        resume: { action: 'approve' },
      }),
      threadConfig,
    );

    expect(resumeResult.status).toBe('approved');
    expect(resumeResult.humanAction?.action).toBe('approve');

    const stateAfterResume = await app.getState(threadConfig);
    expect(stateAfterResume.next).toEqual([]);
  });

  it('Clean Path: resumes with edit and updates draft', async () => {
    const app = createCiteWriterGraph();
    const threadConfig = { configurable: { thread_id: 'test-clean-edit' } };

    await app.invoke(
      {
        runId: 'run-clean-2',
        topic: 'TypeScript 5.0 Features',
      },
      threadConfig,
    );

    const editedDraft = '# Manually Edited Title\n\nVerified by human reviewer.';
    const resumeResult = await app.invoke(
      new Command({
        resume: {
          action: 'edit',
          editedDraft,
        },
      }),
      threadConfig,
    );

    expect(resumeResult.status).toBe('approved');
    expect(resumeResult.draft).toBe(editedDraft);
    expect(resumeResult.humanAction?.action).toBe('edit');
  });

  it('Clean Path: resumes with reject', async () => {
    const app = createCiteWriterGraph();
    const threadConfig = { configurable: { thread_id: 'test-clean-reject' } };

    await app.invoke(
      {
        runId: 'run-clean-3',
        topic: 'TypeScript 5.0 Features',
      },
      threadConfig,
    );

    const resumeResult = await app.invoke(
      new Command({
        resume: {
          action: 'reject',
          feedback: 'Does not meet depth requirements.',
        },
      }),
      threadConfig,
    );

    expect(resumeResult.status).toBe('rejected');
    expect(resumeResult.humanAction?.action).toBe('reject');
  });

  it('Route A: loops back to researcher when needs_more_research is flagged under cap', async () => {
    let factCheckCount = 0;
    const app = createCiteWriterGraph({
      fakeAgentOptions: {
        factCheckerBehavior: (claims) => {
          factCheckCount++;
          if (factCheckCount === 1) {
            return claims.map((c) => ({
              claim: c.claim,
              noteIds: c.noteIds,
              status: 'needs_more_research' as const,
              reason: 'Initial sources insufficient.',
            }));
          }
          return claims.map((c) => ({
            claim: c.claim,
            noteIds: c.noteIds,
            status: 'supported' as const,
            reason: 'Resolved in round 2.',
          }));
        },
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-re-research-loop' } };

    await app.invoke({ runId: 'run-loop-1', topic: 'Testing Research Loop' }, threadConfig);

    const state = await app.getState(threadConfig);
    expect(state.values.researchRounds).toBe(2);
    expect(state.values.writeCycles).toBe(2);
    expect(state.values.status).toBe('awaiting_review');
    expect(state.values.openIssues).toEqual([]);
  });

  it('Route A (Cap hit): stops re-researching when researchRounds reaches cap (2)', async () => {
    const app = createCiteWriterGraph({
      fakeAgentOptions: {
        factCheckerBehavior: (claims) => {
          return claims.map((c) => ({
            claim: c.claim,
            noteIds: c.noteIds,
            status: 'needs_more_research' as const,
            reason: 'Never found primary source.',
          }));
        },
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-research-cap' } };

    await app.invoke({ runId: 'run-research-cap', topic: 'Testing Research Cap' }, threadConfig);

    const state = await app.getState(threadConfig);
    expect(state.values.researchRounds).toBe(2);
    expect(state.values.status).toBe('awaiting_review');
    expect(state.values.openIssues.length).toBeGreaterThan(0);
    expect(
      state.values.openIssues.some((issue: string) => issue.includes('Research cap reached')),
    ).toBe(true);

    // Can still be reviewed and approved
    const resume = await app.invoke(new Command({ resume: { action: 'approve' } }), threadConfig);
    expect(resume.status).toBe('approved');
  });

  it('Route A: loops back to writer when unsupported claims are flagged under cap', async () => {
    let factCheckCount = 0;
    const app = createCiteWriterGraph({
      fakeAgentOptions: {
        factCheckerBehavior: (claims) => {
          factCheckCount++;
          if (factCheckCount === 1) {
            return claims.map((c) => ({
              claim: c.claim,
              noteIds: c.noteIds,
              status: 'unsupported' as const,
              reason: 'Number does not match note quote.',
            }));
          }
          return claims.map((c) => ({
            claim: c.claim,
            noteIds: c.noteIds,
            status: 'supported' as const,
            reason: 'Fixed in cycle 2.',
          }));
        },
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-writer-fix-loop' } };

    await app.invoke({ runId: 'run-write-loop', topic: 'Testing Writer Revision' }, threadConfig);

    const state = await app.getState(threadConfig);
    expect(state.values.writeCycles).toBe(2);
    expect(state.values.status).toBe('awaiting_review');
    expect(state.values.openIssues).toEqual([]);
  });

  it('Route A (Cap hit): stops writer revisions when writeCycles reaches cap (3)', async () => {
    const app = createCiteWriterGraph({
      fakeAgentOptions: {
        factCheckerBehavior: (claims) => {
          return claims.map((c) => ({
            claim: c.claim,
            noteIds: c.noteIds,
            status: 'unsupported' as const,
            reason: 'Unverifiable statement.',
          }));
        },
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-write-cap' } };

    await app.invoke({ runId: 'run-write-cap', topic: 'Testing Write Cap' }, threadConfig);

    const state = await app.getState(threadConfig);
    expect(state.values.writeCycles).toBe(3);
    expect(state.values.status).toBe('awaiting_review');
    expect(state.values.openIssues.length).toBeGreaterThan(0);
    expect(
      state.values.openIssues.some((issue: string) => issue.includes('Write cap reached')),
    ).toBe(true);
  });

  it('Route B: loops back to writer when editor requests revision under cap', async () => {
    let editorCallCount = 0;
    const app = createCiteWriterGraph({
      fakeAgentOptions: {
        editorBehavior: (_draft, _claims, _cycle) => {
          editorCallCount++;
          if (editorCallCount === 1) {
            return {
              score: 5.5,
              feedback: 'Please expand introduction.',
              decision: 'revise',
            };
          }
          return {
            score: 9.0,
            feedback: 'Revised version meets all editorial standards.',
            decision: 'accept',
          };
        },
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-editor-loop' } };

    await app.invoke({ runId: 'run-editor-loop', topic: 'Testing Editor Loop' }, threadConfig);

    const state = await app.getState(threadConfig);
    expect(state.values.writeCycles).toBe(2);
    expect(state.values.editorVerdict?.decision).toBe('accept');
    expect(state.values.status).toBe('awaiting_review');
    expect(state.values.openIssues).toEqual([]);
  });

  it('Route B (Cap hit): stops editor revisions when writeCycles reaches cap (3)', async () => {
    const app = createCiteWriterGraph({
      fakeAgentOptions: {
        editorBehavior: () => ({
          score: 5.0,
          feedback: 'Never satisfied with tone.',
          decision: 'revise',
        }),
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-editor-cap' } };

    await app.invoke({ runId: 'run-editor-cap', topic: 'Testing Editor Cap' }, threadConfig);

    const state = await app.getState(threadConfig);
    expect(state.values.writeCycles).toBe(3);
    expect(state.values.status).toBe('awaiting_review');
    expect(
      state.values.openIssues.some((issue: string) => issue.includes('Write cap reached')),
    ).toBe(true);
  });

  it('Loop Safety: Guaranteed bounded execution and termination even if all checks fail', async () => {
    let callCounter = 0;
    const app = createCiteWriterGraph({
      fakeAgentOptions: {
        factCheckerBehavior: (claims) => {
          callCounter++;
          return claims.map((c) => ({
            claim: c.claim,
            noteIds: c.noteIds,
            status: 'needs_more_research' as const,
            reason: 'Simulated permanent failure.',
          }));
        },
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-safety-bounded' } };

    // Invoking must NOT hang or run forever; it must safely pause at humanReview
    await app.invoke({ runId: 'run-safety', topic: 'Infinite Loop Safety Check' }, threadConfig);

    const state = await app.getState(threadConfig);
    expect(state.values.researchRounds).toBeLessThanOrEqual(2);
    expect(state.values.writeCycles).toBeLessThanOrEqual(3);
    expect(state.values.status).toBe('awaiting_review');
    expect(callCounter).toBeLessThanOrEqual(5);

    // Resuming cleanly terminates
    const finalResult = await app.invoke(
      new Command({ resume: { action: 'reject' } }),
      threadConfig,
    );
    expect(finalResult.status).toBe('rejected');
  });
});
