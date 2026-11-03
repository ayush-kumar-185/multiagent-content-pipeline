import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';

export interface CheckpointerContext {
  checkpointer: PostgresSaver;
  setup: () => Promise<void>;
}

export function createPostgresCheckpointer(pool: pg.Pool): CheckpointerContext {
  const checkpointer = new PostgresSaver(pool);

  return {
    checkpointer,
    setup: async () => {
      await checkpointer.setup();
    },
  };
}
