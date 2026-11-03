import {
  pgTable,
  text,
  varchar,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  serial,
  index,
} from 'drizzle-orm/pg-core';
import type {
  Note,
  Claim,
  ClaimCheck,
  EditorVerdict,
  RunConfig,
  RunAgentMetrics,
} from '@citewriter/core';

export const users = pgTable('users', {
  id: varchar('id', { length: 128 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: text('name'),
  role: varchar('role', { length: 32 }).notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable(
  'runs',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    sourceUrl: text('source_url'),
    config: jsonb('config').$type<RunConfig>().notNull(),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    draft: text('draft').notNull().default(''),
    claims: jsonb('claims').$type<Claim[]>().notNull().default([]),
    claimChecks: jsonb('claim_checks').$type<ClaimCheck[]>().notNull().default([]),
    editorVerdict: jsonb('editor_verdict').$type<EditorVerdict | null>(),
    notes: jsonb('notes').$type<Note[]>().notNull().default([]),
    researchRounds: integer('research_rounds').notNull().default(0),
    writeCycles: integer('write_cycles').notNull().default(0),
    openIssues: jsonb('open_issues').$type<string[]>().notNull().default([]),
    tokensUsed: integer('tokens_used').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    agentMetrics: jsonb('agent_metrics').$type<RunAgentMetrics>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('runs_user_id_idx').on(table.userId),
    index('runs_status_idx').on(table.status),
  ],
);

export const runEvents = pgTable(
  'run_events',
  {
    id: serial('id').primaryKey(),
    runId: varchar('run_id', { length: 128 })
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    node: varchar('node', { length: 64 }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('run_events_run_id_seq_idx').on(table.runId, table.sequence),
    index('run_events_run_id_idx').on(table.runId),
  ],
);

export const draftVersions = pgTable(
  'draft_versions',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    runId: varchar('run_id', { length: 128 })
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    draft: text('draft').notNull(),
    claims: jsonb('claims').$type<Claim[]>().notNull().default([]),
    cycle: integer('cycle').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('draft_versions_run_id_version_idx').on(table.runId, table.version),
    index('draft_versions_run_id_idx').on(table.runId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunEvent = typeof runEvents.$inferSelect;
export type NewRunEvent = typeof runEvents.$inferInsert;
export type DraftVersion = typeof draftVersions.$inferSelect;
export type NewDraftVersion = typeof draftVersions.$inferInsert;
