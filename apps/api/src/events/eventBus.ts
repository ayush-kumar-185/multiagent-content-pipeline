import { EventEmitter } from 'node:events';
import { sql, eq, and, gt, asc } from 'drizzle-orm';
import { DatabaseContext, runEvents, RunEvent } from '../db/index.js';

export interface EmitEventParams {
  runId: string;
  type: string;
  node?: string;
  data?: Record<string, unknown>;
}

export class RunEventBus extends EventEmitter {
  private dbCtx: DatabaseContext;

  constructor(dbCtx: DatabaseContext) {
    super();
    this.dbCtx = dbCtx;
    // Increase listener limit for concurrent SSE clients
    this.setMaxListeners(100);
  }

  /**
   * Persists an event into PostgreSQL with the next sequence number and emits to listeners.
   */
  async recordEvent(params: EmitEventParams): Promise<RunEvent> {
    const { runId, type, node, data = {} } = params;

    // Compute next sequence number for this run
    const maxSeqRes = await this.dbCtx.db
      .select({
        maxSeq: sql<number>`coalesce(max(${runEvents.sequence}), 0)`,
      })
      .from(runEvents)
      .where(eq(runEvents.runId, runId));

    const nextSeq = (maxSeqRes[0]?.maxSeq ?? 0) + 1;

    const [event] = await this.dbCtx.db
      .insert(runEvents)
      .values({
        runId,
        sequence: nextSeq,
        type,
        node: node ?? null,
        data,
      })
      .returning();

    if (!event) {
      throw new Error(`Failed to persist event for run ${runId}`);
    }

    // Emit event on channel for this runId
    this.emit(`run:${runId}`, event);
    return event;
  }

  /**
   * Retrieves events for a run since lastSequence (for SSE reconnection).
   */
  async getEventsSince(runId: string, lastSequence = 0): Promise<RunEvent[]> {
    return this.dbCtx.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, lastSequence)))
      .orderBy(asc(runEvents.sequence));
  }

  /**
   * Subscribes to live events for a specific runId.
   */
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const eventName = `run:${runId}`;
    this.on(eventName, listener);
    return () => {
      this.off(eventName, listener);
    };
  }
}
