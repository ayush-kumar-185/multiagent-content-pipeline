import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface RunJobData {
  runId: string;
  action?: 'start' | 'resume';
  resumePayload?: {
    action: 'approve' | 'edit' | 'reject';
    feedback?: string;
    editedDraft?: string;
  };
}

export const CITEWRITER_RUNS_QUEUE = 'citewriter-runs';

export function createRedisConnection(): Redis {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
}

export function createRunQueue(
  redis?: Redis,
  queueName: string = CITEWRITER_RUNS_QUEUE,
): Queue<RunJobData> {
  const connection = redis ?? createRedisConnection();
  return new Queue<RunJobData>(queueName, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
}

export * from './worker.js';
