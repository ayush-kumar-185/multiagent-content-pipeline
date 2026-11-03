import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export interface DatabaseContext {
  db: NodePgDatabase<typeof schema>;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDatabase(connectionString?: string): DatabaseContext {
  const connStr =
    connectionString ||
    process.env.DATABASE_URL ||
    'postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter';

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 10,
    idleTimeoutMillis: 30000,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

export * from './schema.js';
