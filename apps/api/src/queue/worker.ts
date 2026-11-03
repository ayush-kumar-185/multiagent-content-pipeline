import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { eq, and, notInArray } from 'drizzle-orm';
import {
  createCiteWriterGraph,
  GraphState,
  Command,
  GraphBuilderOptions,
  BaseCheckpointSaver,
  getTracer,
} from '@citewriter/core';
import { DatabaseContext, runs, draftVersions } from '../db/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { RunJobData, CITEWRITER_RUNS_QUEUE, createRedisConnection } from './index.js';

export interface WorkerDependencies {
  dbCtx: DatabaseContext;
  checkpointer: BaseCheckpointSaver;
  eventBus: RunEventBus;
  redis?: Redis;
  queueName?: string;
  graphOptions?: Partial<GraphBuilderOptions>;
}

export function createRunWorker(deps: WorkerDependencies): Worker<RunJobData> {
  const {
    dbCtx,
    checkpointer,
    eventBus,
    graphOptions = {},
    queueName = CITEWRITER_RUNS_QUEUE,
  } = deps;
  const connection = deps.redis ?? createRedisConnection();

  const worker = new Worker<RunJobData>(
    queueName,
    async (job: Job<RunJobData>) => {
      const { runId, action, resumePayload } = job.data;

      // 1. Fetch current run record
      const [runRecord] = await dbCtx.db.select().from(runs).where(eq(runs.id, runId));

      if (!runRecord) {
        throw new Error(`Run ${runId} not found`);
      }

      // If run was already terminated or rejected/canceled, do not run
      if (['approved', 'rejected', 'failed'].includes(runRecord.status) && action !== 'resume') {
        return { status: runRecord.status, runId };
      }

      // 2. Mark running in database (atomic check to avoid race with concurrent cancellation)
      const [updated] = await dbCtx.db
        .update(runs)
        .set({ status: 'running', updatedAt: new Date() })
        .where(and(eq(runs.id, runId), notInArray(runs.status, ['approved', 'rejected', 'failed'])))
        .returning();

      if (!updated) {
        return { status: runRecord.status, runId };
      }

      await eventBus.recordEvent({
        runId,
        type: 'status_change',
        data: { status: 'running', action: action ?? 'start' },
      });

      // 3. Initialize Observability Trace & Compile graph with checkpointer
      const tracer = getTracer();
      tracer.startRunTrace(runId, {
        topic: runRecord.topic,
        config: runRecord.config,
        userId: runRecord.userId,
      });

      const hasLLMKey = Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);
      const isTestEnv = process.env.NODE_ENV === 'test';
      const defaultUseReal = hasLLMKey && !isTestEnv;

      const app = createCiteWriterGraph({
        useRealResearcher: graphOptions.useRealResearcher ?? defaultUseReal,
        useRealWriter: graphOptions.useRealWriter ?? defaultUseReal,
        useRealFactChecker: graphOptions.useRealFactChecker ?? defaultUseReal,
        useRealEditor: graphOptions.useRealEditor ?? defaultUseReal,
        ...graphOptions,
        checkpointer,
        tracer,
      });

      try {
        // 4. Determine input (resume Command vs initial state)
        let input: Parameters<typeof app.stream>[0];
        if (action === 'resume' && resumePayload) {
          input = new Command({ resume: resumePayload });
        } else {
          input = {
            runId,
            topic: runRecord.topic,
            sourceUrl: runRecord.sourceUrl ?? undefined,
            config: runRecord.config,
          };
        }

        // 5. Stream node updates
        const stream = await app.stream(input, {
          configurable: { thread_id: runId },
          streamMode: 'updates',
        });

        for await (const chunk of stream) {
          for (const [nodeName, updateRaw] of Object.entries(chunk)) {
            const update = updateRaw as Partial<GraphState>;

            await eventBus.recordEvent({
              runId,
              type: 'node_end',
              node: nodeName,
              data: {
                summary: `Completed ${nodeName}`,
                writeCycles: update.writeCycles,
                researchRounds: update.researchRounds,
              },
            });

            // Persist progress to DB
            const patch: Partial<typeof runs.$inferInsert> = {
              updatedAt: new Date(),
            };
            if (update.draft !== undefined) patch.draft = update.draft;
            if (update.claims !== undefined) patch.claims = update.claims;
            if (update.claimChecks !== undefined) patch.claimChecks = update.claimChecks;
            if (update.editorVerdict !== undefined) patch.editorVerdict = update.editorVerdict;
            if (update.notes !== undefined) patch.notes = update.notes;
            if (update.researchRounds !== undefined) patch.researchRounds = update.researchRounds;
            if (update.writeCycles !== undefined) patch.writeCycles = update.writeCycles;
            if (update.tokensUsed !== undefined) patch.tokensUsed = update.tokensUsed;
            if (update.costUsd !== undefined) patch.costUsd = update.costUsd;
            if (update.agentMetrics !== undefined) patch.agentMetrics = update.agentMetrics;
            if (update.openIssues !== undefined) patch.openIssues = update.openIssues;

            if (Object.keys(patch).length > 1) {
              await dbCtx.db.update(runs).set(patch).where(eq(runs.id, runId));
            }
          }
        }

        // 6. Inspect snapshot state from checkpointer
        const finalSnapshot = await app.getState({ configurable: { thread_id: runId } });
        const finalState = finalSnapshot.values as GraphState;

        // Check if run was canceled/rejected in the meantime
        const [currentRun] = await dbCtx.db
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, runId));

        if (currentRun && ['rejected', 'failed'].includes(currentRun.status)) {
          return { status: currentRun.status, runId };
        }

        // Persist final state
        await dbCtx.db
          .update(runs)
          .set({
            status: finalState.status,
            draft: finalState.draft ?? '',
            claims: finalState.claims ?? [],
            claimChecks: finalState.claimChecks ?? [],
            editorVerdict: finalState.editorVerdict ?? null,
            notes: finalState.notes ?? [],
            researchRounds: finalState.researchRounds ?? 0,
            writeCycles: finalState.writeCycles ?? 0,
            tokensUsed: finalState.tokensUsed ?? 0,
            costUsd: finalState.costUsd ?? 0,
            agentMetrics: finalState.agentMetrics ?? {},
            openIssues: finalState.openIssues ?? [],
            updatedAt: new Date(),
          })
          .where(eq(runs.id, runId));

        // Save draft version if draft exists
        if (finalState.draft && finalState.writeCycles > 0) {
          try {
            await dbCtx.db
              .insert(draftVersions)
              .values({
                id: `draft-${runId}-v${finalState.writeCycles}`,
                runId,
                version: finalState.writeCycles,
                draft: finalState.draft,
                claims: finalState.claims ?? [],
                cycle: finalState.writeCycles,
              })
              .onConflictDoNothing();
          } catch {
            // draft version already saved or duplicate key; non-fatal
          }
        }

        // 7. Emit final event based on terminal or paused status
        if (finalState.status === 'awaiting_review') {
          await eventBus.recordEvent({
            runId,
            type: 'review_ready',
            node: 'humanReview',
            data: {
              status: 'awaiting_review',
              draftLength: finalState.draft?.length ?? 0,
              claimsCount: finalState.claims?.length ?? 0,
            },
          });
        } else if (finalState.status === 'approved' || finalState.status === 'rejected') {
          await eventBus.recordEvent({
            runId,
            type: 'run_completed',
            node: 'humanReview',
            data: { status: finalState.status },
          });
        } else if (finalState.status === 'budget_exceeded') {
          await eventBus.recordEvent({
            runId,
            type: 'budget_exceeded',
            data: {
              tokensUsed: finalState.tokensUsed,
              costUsd: finalState.costUsd,
              openIssues: finalState.openIssues,
            },
          });
        }

        await tracer.flush().catch(() => {});
        return { status: finalState.status, runId };
      } catch (error) {
        await tracer.flush().catch(() => {});
        const errorMsg = error instanceof Error ? error.message : String(error);
        await dbCtx.db
          .update(runs)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(runs.id, runId));

        await eventBus.recordEvent({
          runId,
          type: 'run_failed',
          data: { error: errorMsg },
        });

        throw error;
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );

  return worker;
}
