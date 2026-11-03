import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

async function runMigrations() {
  const { db, pool } = createDatabase();
  console.log(`Running Drizzle migrations from ${migrationsFolder}...`);
  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
