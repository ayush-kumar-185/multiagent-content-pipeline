import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createCiteWriterGraph, GraphState, Command } from '@citewriter/core';
import { createPostgresCheckpointer } from './index.js';

describe('Postgres Checkpointer for LangGraph', () => {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter';

  let pool: pg.Pool;
  let checkpointer: ReturnType<typeof createPostgresCheckpointer>['checkpointer'];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString });
    const ctx = createPostgresCheckpointer(pool);
    await ctx.setup();
    checkpointer = ctx.checkpointer;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('initializes and creates checkpoint tables in postgres', async () => {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE 'checkpoint%'
    `);
    const tables = res.rows.map((r) => r.table_name);
    expect(tables).toContain('checkpoints');
    expect(tables).toContain('checkpoint_blobs');
    expect(tables).toContain('checkpoint_writes');
  });

  it('persists graph interruption and resumes across graph instances using runId as thread_id', async () => {
    const runId = `test-persistence-${Date.now()}`;
    const graph1 = createCiteWriterGraph({ checkpointer });

    const initialState: Partial<GraphState> = {
      runId,
      topic: 'LangGraph Persistence with PostgreSQL',
      config: {
        audience: 'engineers',
        tone: 'technical',
        targetWords: 300,
      },
    };

    // First invocation pauses at humanReview
    const pausedState = (await graph1.invoke(initialState, {
      configurable: { thread_id: runId },
    })) as GraphState;

    expect(pausedState.runId).toBe(runId);
    expect(pausedState.status).toBe('awaiting_review');
    expect(pausedState.draft).toBeTruthy();

    // Verify checkpoint exists in Postgres for this thread
    const cpRes = await pool.query(
      `SELECT thread_id, checkpoint_id FROM checkpoints WHERE thread_id = $1`,
      [runId],
    );
    expect(cpRes.rows.length).toBeGreaterThan(0);
    expect(cpRes.rows[0].thread_id).toBe(runId);

    // Simulate server restart: create brand new graph instance with checkpointer
    const graph2 = createCiteWriterGraph({ checkpointer });
    const resumedState = (await graph2.invoke(
      new Command({
        resume: { action: 'approve' },
      }),
      {
        configurable: { thread_id: runId },
      },
    )) as GraphState;

    expect(resumedState.runId).toBe(runId);
    expect(resumedState.status).toBe('approved');
  });
});
