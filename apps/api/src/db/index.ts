import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import path from 'node:path';
import dotenv from 'dotenv';
import * as schema from './schema.js';

// Ensure environment variables are loaded
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

export class DatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseGuardError';
  }
}

export function extractDatabaseName(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const pathname = url.pathname.replace(/^\//, '');
    return pathname.split('?')[0] || '';
  } catch {
    const match = connectionString.match(/\/([^/?]+)(?:\?|$)/);
    return match && match[1] ? match[1] : '';
  }
}

export function resolveDatabaseUrl(connectionString?: string): string {
  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

  if (isTest) {
    // If caller explicitly passed DATABASE_URL or attempted to use it in tests
    if (
      process.env.DATABASE_URL &&
      connectionString === process.env.DATABASE_URL &&
      process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST
    ) {
      throw new DatabaseGuardError(
        'Test database guard violation: Refusing to use production/dev DATABASE_URL in test environment. Use DATABASE_URL_TEST.',
      );
    }

    const testUrl = connectionString || process.env.DATABASE_URL_TEST;

    if (!testUrl) {
      throw new DatabaseGuardError(
        'Test database guard violation: NODE_ENV=test or VITEST is set, but DATABASE_URL_TEST is not defined. Refusing to fall back to DATABASE_URL in test environment.',
      );
    }

    const dbName = extractDatabaseName(testUrl);
    if (!dbName.endsWith('_test')) {
      throw new DatabaseGuardError(
        `Test database guard violation: Refusing to connect to database "${dbName}". Test database name must end with "_test".`,
      );
    }

    return testUrl;
  }

  // Non-test environment
  const target =
    connectionString ||
    process.env.DATABASE_URL ||
    'postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter';

  return target;
}

export interface DatabaseContext {
  db: NodePgDatabase<typeof schema>;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDatabase(connectionString?: string): DatabaseContext {
  const connStr = resolveDatabaseUrl(connectionString);

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
