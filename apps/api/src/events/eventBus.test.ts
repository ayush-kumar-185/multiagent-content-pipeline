import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabase, DatabaseContext, users, runs } from '../db/index.js';
import { RunEventBus } from './eventBus.js';

describe('RunEventBus with PostgreSQL Persistence', () => {
  let dbCtx: DatabaseContext;
  let eventBus: RunEventBus;
  const testUserId = `test-user-bus-${Date.now()}`;
  const testRunId = `test-run-bus-${Date.now()}`;

  beforeAll(async () => {
    dbCtx = createDatabase();
    eventBus = new RunEventBus(dbCtx);

    // Create test user and run
    await dbCtx.db.insert(users).values({
      id: testUserId,
      email: `${testUserId}@example.com`,
      name: 'EventBus Tester',
    });

    await dbCtx.db.insert(runs).values({
      id: testRunId,
      userId: testUserId,
      topic: 'Testing EventBus Sequence Persistence',
      config: {
        audience: 'engineers',
        tone: 'technical',
        targetWords: 300,
      },
      status: 'pending',
    });
  });

  afterAll(async () => {
    await dbCtx.close();
  });

  it('records events with strictly monotonic sequence numbers starting from 1', async () => {
    const receivedEvents: unknown[] = [];
    const unsubscribe = eventBus.subscribe(testRunId, (evt) => {
      receivedEvents.push(evt);
    });

    const evt1 = await eventBus.recordEvent({
      runId: testRunId,
      type: 'run_created',
      data: { topic: 'Testing EventBus' },
    });

    const evt2 = await eventBus.recordEvent({
      runId: testRunId,
      type: 'node_start',
      node: 'researcher',
      data: { round: 1 },
    });

    const evt3 = await eventBus.recordEvent({
      runId: testRunId,
      type: 'node_end',
      node: 'researcher',
      data: { notesFound: 4 },
    });

    unsubscribe();

    expect(evt1.sequence).toBe(1);
    expect(evt2.sequence).toBe(2);
    expect(evt3.sequence).toBe(3);
    expect(receivedEvents).toHaveLength(3);
  });

  it('replays missed events since lastSequence for reconnection', async () => {
    // Replay after sequence 1
    const replayed = await eventBus.getEventsSince(testRunId, 1);
    expect(replayed).toHaveLength(2);
    expect(replayed[0]!.sequence).toBe(2);
    expect(replayed[0]!.node).toBe('researcher');
    expect(replayed[1]!.sequence).toBe(3);
    expect(replayed[1]!.type).toBe('node_end');

    // Replay after sequence 3
    const empty = await eventBus.getEventsSince(testRunId, 3);
    expect(empty).toHaveLength(0);
  });
});
