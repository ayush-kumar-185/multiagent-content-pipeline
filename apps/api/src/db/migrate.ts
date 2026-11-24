import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createDatabase } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runDatabaseMigrations(db: NodePgDatabase<Record<string, unknown>>): Promise<void> {
  const possiblePaths = [
    path.resolve(__dirname, '../../drizzle'),
    path.resolve(__dirname, '../drizzle'),
    path.resolve(process.cwd(), 'apps/api/drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];
  const migrationsFolder = possiblePaths.find((p) => fs.existsSync(p));
  if (!migrationsFolder) {
    console.warn('[Drizzle] Migrations folder not found, skipping migration check.');
    return;
  }
  console.log(`[CiteWriter API] Applying Drizzle migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log('[CiteWriter API] Drizzle migrations applied successfully.');
}

async function runStandaloneMigrations() {
  const { db, pool } = createDatabase();
  try {
    await runDatabaseMigrations(db);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only auto-run if executed directly as entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runStandaloneMigrations();
}
