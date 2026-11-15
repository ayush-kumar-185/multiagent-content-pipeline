import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { eq, and, desc, sql, inArray, gte } from 'drizzle-orm';
import {
  RunConfig,
  getAgentModel,
  getDailyModelTokens,
  getModelDailyLimit,
  AgentRole,
} from '@citewriter/core';
import { DatabaseContext, runs } from '../db/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { RunJobData } from '../queue/index.js';
import { Queue } from 'bullmq';

const CreateRunBodySchema = z.object({
  topic: z
    .string()
    .min(3, 'Topic must be at least 3 characters')
    .max(1000, 'Topic must not exceed 1000 characters'),
  sourceUrl: z
    .string()
    .url('Invalid source URL format')
    .refine((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Only HTTP and HTTPS URLs are permitted')
    .optional(),
  config: z
    .object({
      audience: z.string().max(200).optional(),
      tone: z.string().max(200).optional(),
      format: z.enum(['article', 'linkedin_post', 'twitter_thread']).optional(),
      targetWords: z.number().int().min(50).max(5000).optional(),
      maxTokens: z.number().int().positive().max(1_000_000).optional(),
      maxCostUsd: z.number().positive().max(100).optional(),
    })
    .optional(),
});

const ResumeRunBodySchema = z.object({
  action: z.enum(['approve', 'edit', 'reject']),
  feedback: z.string().max(5000).optional(),
  editedDraft: z.string().max(100_000).optional(),
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
        code: 'VALIDATION_ERROR',
        message: 'Invalid run creation payload',
        validationErrors: parseResult.error.flatten(),
      });
      return;
    }

    const { topic, sourceUrl, config } = parseResult.data;
    const clientIp = req.ip || '127.0.0.1';
    const isRealMode = process.env.USE_REAL_LLM === 'true';

    // 1. Check Global Concurrent Runs Cap (MAX_CONCURRENT_RUNS, default 1)
    const maxGlobalConcurrent = Number(process.env.MAX_CONCURRENT_RUNS || 1);
    const [globalActiveRes] = await dbCtx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(runs)
      .where(inArray(runs.status, ['pending', 'running']));

    if ((globalActiveRes?.count ?? 0) >= maxGlobalConcurrent) {
      reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        code: 'GLOBAL_CONCURRENCY_EXCEEDED',
        message: `Global concurrent run limit reached (${maxGlobalConcurrent} active run allowed). Please wait for the current run to complete.`,
        retryHint: 'Wait for the active run to complete before starting a new run.',
      });
      return;
    }

    // 2. Check Global Daily Cap (MAX_RUNS_PER_DAY, UTC day, default 10)
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const maxGlobalRunsPerDay = Number(process.env.MAX_RUNS_PER_DAY || 10);
    const [globalDailyRes] = await dbCtx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(runs)
      .where(gte(runs.createdAt, startOfUtcDay));

    if ((globalDailyRes?.count ?? 0) >= maxGlobalRunsPerDay) {
      reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        code: 'GLOBAL_DAILY_CAP_EXCEEDED',
        message: `Global daily run limit reached (${maxGlobalRunsPerDay} runs per day).`,
        retryHint: 'Global run quota resets tomorrow at 00:00 UTC. Please try again tomorrow.',
      });
      return;
    }

    // 3. Check Per-IP Daily Cap (MAX_RUNS_PER_IP_PER_DAY, UTC day, default 5)
    const maxRunsPerIp = Number(process.env.MAX_RUNS_PER_IP_PER_DAY || 5);
    const [ipDailyRes] = await dbCtx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.ip, clientIp), gte(runs.createdAt, startOfUtcDay)));

    if ((ipDailyRes?.count ?? 0) >= maxRunsPerIp) {
      reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        code: 'IP_DAILY_CAP_EXCEEDED',
        message: `Daily run limit for IP ${clientIp} reached (${maxRunsPerIp} runs per day).`,
        retryHint: 'Your daily IP quota resets tomorrow at 00:00 UTC. Please try again tomorrow.',
      });
      return;
    }

    // 4. Check user active run limits
    const [activeCountRes] = await dbCtx.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(runs)
      .where(and(eq(runs.userId, user.id), inArray(runs.status, ['pending', 'running'])));

    if ((activeCountRes?.count ?? 0) >= maxConcurrentRunsPerUser) {
      reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        code: 'USER_CONCURRENT_LIMIT_EXCEEDED',
        message: `Maximum active runs limit reached (${maxConcurrentRunsPerUser} concurrent runs allowed for this user)`,
        retryHint: 'Wait for your active run to finish before starting another.',
      });
      return;
    }

    // 5. Check Token Ledger Headroom in Real Mode
    if (isRealMode) {
      const headroom = Number(
        process.env.LEDGER_HEADROOM_TOKENS || process.env.MAX_RUN_TOKENS || 25000,
      );
      const agentRoles: AgentRole[] = ['researcher', 'writer', 'factChecker', 'editor'];

      for (const role of agentRoles) {
        const model = getAgentModel(role);
        const dailyLimit = getModelDailyLimit(model);

        if (dailyLimit && dailyLimit > 0) {
          const currentTokens = getDailyModelTokens(model)?.totalTokens ?? 0;
          const remaining = dailyLimit - currentTokens;

          if (remaining < headroom) {
            reply.status(429).send({
              statusCode: 429,
              error: 'Too Many Requests',
              code: 'QUOTA_EXHAUSTED',
              message: 'quota exhausted, try later',
              retryHint: `Daily token quota for model "${model}" has only ${remaining} tokens remaining, which is below the required headroom (${headroom} tokens). Daily quota resets at 00:00 UTC.`,
            });
            return;
          }
        }
      }
    }

    const runId = `run_${crypto.randomUUID()}`;
    const runFormat = config?.format ?? 'article';
    const defaultWords =
      runFormat === 'twitter_thread' ? 250 : runFormat === 'linkedin_post' ? 200 : 400;

    const runConfig: RunConfig = {
      audience: config?.audience ?? 'engineers and technical readers',
      tone: config?.tone ?? 'authoritative, clear, and informative',
      format: runFormat,
      targetWords: config?.targetWords ?? defaultWords,
      maxTokens: config?.maxTokens,
      maxCostUsd: config?.maxCostUsd,
    };

    const runMode = isRealMode ? 'real' : 'mock';

    const [newRun] = await dbCtx.db
      .insert(runs)
      .values({
        id: runId,
        userId: user.id,
        topic,
        sourceUrl: sourceUrl ?? null,
        config: runConfig,
        status: 'pending',
        mode: runMode,
        ip: clientIp,
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
          code: 'VALIDATION_ERROR',
          message: 'Invalid resume payload',
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
