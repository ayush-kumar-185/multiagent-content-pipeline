import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { RunConfig } from '@citewriter/core';
import { DatabaseContext, runs } from '../db/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { RunJobData } from '../queue/index.js';
import { Queue } from 'bullmq';

const CreateRunBodySchema = z.object({
  topic: z.string().min(3, 'Topic must be at least 3 characters'),
  sourceUrl: z.string().url().optional(),
  config: z
    .object({
      audience: z.string().optional(),
      tone: z.string().optional(),
      targetWords: z.number().int().min(50).max(5000).optional(),
      maxTokens: z.number().int().positive().optional(),
      maxCostUsd: z.number().positive().optional(),
    })
    .optional(),
});

const ResumeRunBodySchema = z.object({
  action: z.enum(['approve', 'edit', 'reject']),
  feedback: z.string().optional(),
  editedDraft: z.string().optional(),
});

export interface RunRoutesOptions extends FastifyPluginOptions {
  dbCtx: DatabaseContext;
  eventBus: RunEventBus;
  queue: Queue<RunJobData>;
  maxConcurrentRunsPerUser?: number;
}

export function registerRunRoutes(app: FastifyInstance, options: RunRoutesOptions) {
  const { dbCtx, eventBus, queue, maxConcurrentRunsPerUser = 3 } = options;

  // POST /runs - Start new run
  app.post('/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const parseResult = CreateRunBodySchema.safeParse(req.body);

    if (!parseResult.success) {
      reply.status(400).send({
        error: 'Bad Request',
        validationErrors: parseResult.error.flatten(),
      });
      return;
    }

    const { topic, sourceUrl, config } = parseResult.data;

    // Check user active run limits
    const [activeCountRes] = await dbCtx.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(runs)
      .where(and(eq(runs.userId, user.id), inArray(runs.status, ['pending', 'running'])));

    if ((activeCountRes?.count ?? 0) >= maxConcurrentRunsPerUser) {
      reply.status(429).send({
        error: 'Too Many Requests',
        message: `Maximum active runs limit reached (${maxConcurrentRunsPerUser} concurrent runs allowed)`,
      });
      return;
    }

    const runId = `run_${crypto.randomUUID()}`;
    const runConfig: RunConfig = {
      audience: config?.audience ?? 'engineers and technical readers',
      tone: config?.tone ?? 'authoritative, clear, and informative',
      targetWords: config?.targetWords ?? 400,
      maxTokens: config?.maxTokens,
      maxCostUsd: config?.maxCostUsd,
    };

    const [newRun] = await dbCtx.db
      .insert(runs)
      .values({
        id: runId,
        userId: user.id,
        topic,
        sourceUrl: sourceUrl ?? null,
        config: runConfig,
        status: 'pending',
      })
      .returning();

    // Record initial creation event
    await eventBus.recordEvent({
      runId,
      type: 'run_created',
      data: { topic, runId },
    });

    // Enqueue background BullMQ job
    await queue.add('execute-run', {
      runId,
      action: 'start',
    });

    reply.status(201).send(newRun);
  });

  // GET /runs - List runs for user
  app.get('/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const userRuns = await dbCtx.db
      .select()
      .from(runs)
      .where(eq(runs.userId, user.id))
      .orderBy(desc(runs.createdAt));

    reply.send({ runs: userRuns });
  });

  // GET /runs/:id - Get run details
  app.get(
    '/runs/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = req.user!;
      const { id } = req.params;

      const [run] = await dbCtx.db
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.userId, user.id)));

      if (!run) {
        reply.status(404).send({ error: 'Not Found', message: `Run ${id} not found` });
        return;
      }

      reply.send(run);
    },
  );

  // GET /runs/:id/events - SSE Stream with Last-Event-ID reconnection
  app.get(
    '/runs/:id/events',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: { lastEventId?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const user = req.user!;
      const { id } = req.params;

      const [run] = await dbCtx.db
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.userId, user.id)));

      if (!run) {
        reply.status(404).send({ error: 'Not Found', message: `Run ${id} not found` });
        return;
      }

      // Check for Last-Event-ID in header or query param
      const lastEventIdRaw = req.headers['last-event-id'] || req.query.lastEventId;
      const lastEventId = lastEventIdRaw ? parseInt(String(lastEventIdRaw), 10) : 0;

      // Set headers for SSE
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      });

      // 1. Replay missed events
      const missedEvents = await eventBus.getEventsSince(id, isNaN(lastEventId) ? 0 : lastEventId);
      for (const evt of missedEvents) {
        reply.raw.write(
          `id: ${evt.sequence}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`,
        );
      }

      // If run is already completed/failed/budget_exceeded, end stream after replaying
      if (['approved', 'rejected', 'failed', 'budget_exceeded'].includes(run.status)) {
        reply.raw.end();
        return;
      }

      // 2. Subscribe to live events
      const unsubscribe = eventBus.subscribe(id, (evt) => {
        reply.raw.write(
          `id: ${evt.sequence}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`,
        );
        if (['run_completed', 'run_failed', 'budget_exceeded'].includes(evt.type)) {
          reply.raw.end();
        }
      });

      // Keepalive ping every 15s to prevent intermediate proxies from timing out
      const pingInterval = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(': ping\n\n');
        }
      }, 15000);

      req.raw.on('close', () => {
        clearInterval(pingInterval);
        unsubscribe();
      });
    },
  );

  // POST /runs/:id/resume - Resume human review
  app.post(
    '/runs/:id/resume',
    async (
      req: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply,
    ) => {
      const user = req.user!;
      const { id } = req.params;

      const parseResult = ResumeRunBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        reply.status(400).send({
          error: 'Bad Request',
          validationErrors: parseResult.error.flatten(),
        });
        return;
      }

      const [run] = await dbCtx.db
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.userId, user.id)));

      if (!run) {
        reply.status(404).send({ error: 'Not Found', message: `Run ${id} not found` });
        return;
      }

      if (run.status !== 'awaiting_review') {
        reply.status(400).send({
          error: 'Bad Request',
          message: `Run is currently in status '${run.status}', expected 'awaiting_review'`,
        });
        return;
      }

      // Enqueue resume job
      await queue.add('resume-run', {
        runId: id,
        action: 'resume',
        resumePayload: parseResult.data,
      });

      reply.send({
        status: 'resuming',
        runId: id,
        decision: parseResult.data.action,
      });
    },
  );

  // POST /runs/:id/cancel - Cancel run
  app.post(
    '/runs/:id/cancel',
    async (
      req: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply,
    ) => {
      const user = req.user!;
      const { id } = req.params;

      const [run] = await dbCtx.db
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.userId, user.id)));

      if (!run) {
        reply.status(404).send({ error: 'Not Found', message: `Run ${id} not found` });
        return;
      }

      if (['approved', 'rejected', 'failed'].includes(run.status)) {
        reply.send({ status: run.status, message: 'Run was already finished' });
        return;
      }

      await dbCtx.db
        .update(runs)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(runs.id, id));

      try {
        const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
        for (const j of jobs) {
          if (j.data?.runId === id) {
            await j.remove().catch(() => {});
          }
        }
      } catch {
        // best effort queue removal
      }

      await eventBus.recordEvent({
        runId: id,
        type: 'status_change',
        data: { status: 'rejected', reason: 'canceled_by_user' },
      });

      reply.send({ status: 'canceled', runId: id });
    },
  );
}
