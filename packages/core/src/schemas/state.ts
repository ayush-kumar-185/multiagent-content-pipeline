import { z } from 'zod';
import { Annotation } from '@langchain/langgraph';
import { NoteSchema, type Note } from './note.js';
import { ClaimSchema, ClaimCheckSchema, type Claim, type ClaimCheck } from './claim.js';
import { EditorVerdictSchema, type EditorVerdict } from './editor.js';
import { RunConfigSchema, type RunConfig } from './config.js';

export const RunStatusSchema = z.enum([
  'running',
  'awaiting_review',
  'approved',
  'rejected',
  'failed',
  'budget_exceeded',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const HumanActionSchema = z.object({
  action: z.enum(['approve', 'edit', 'reject']),
  feedback: z.string().optional(),
  editedDraft: z.string().optional(),
});

export type HumanAction = z.infer<typeof HumanActionSchema>;

export const AgentMetricsSchema = z.object({
  tokensUsed: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  calls: z.number().int().nonnegative().default(0),
});

export type AgentMetrics = z.infer<typeof AgentMetricsSchema>;

export const RunAgentMetricsSchema = z.record(z.string(), AgentMetricsSchema);
export type RunAgentMetrics = z.infer<typeof RunAgentMetricsSchema>;

export function mergeAgentMetrics(
  existing?: RunAgentMetrics,
  incoming?: RunAgentMetrics,
): RunAgentMetrics {
  const result: RunAgentMetrics = { ...(existing ?? {}) };
  if (!incoming) return result;

  for (const [agent, m] of Object.entries(incoming)) {
    const prev = result[agent] ?? { tokensUsed: 0, costUsd: 0, calls: 0 };
    result[agent] = {
      tokensUsed: prev.tokensUsed + m.tokensUsed,
      costUsd: Number((prev.costUsd + m.costUsd).toFixed(6)),
      calls: prev.calls + m.calls,
    };
  }

  return result;
}

export const GraphStateSchema = z.object({
  runId: z.string().min(1),
  topic: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  config: RunConfigSchema.default(() => ({
    audience: 'software engineers',
    tone: 'technical and precise',
    targetWords: 800,
  })),
  notes: z.array(NoteSchema).default([]),
  researchRounds: z.number().int().nonnegative().default(0),
  draft: z.string().default(''),
  claims: z.array(ClaimSchema).default([]),
  writeCycles: z.number().int().nonnegative().default(0),
  claimChecks: z.array(ClaimCheckSchema).default([]),
  editorVerdict: EditorVerdictSchema.optional(),
  tokensUsed: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  agentMetrics: RunAgentMetricsSchema.default({}),
  status: RunStatusSchema.default('running'),
  openIssues: z.array(z.string()).default([]),
  humanAction: HumanActionSchema.optional(),
});

export type GraphState = z.infer<typeof GraphStateSchema>;

export const StateAnnotation = Annotation.Root({
  runId: Annotation<string>({
    reducer: (x, y) => y ?? x,
  }),
  topic: Annotation<string>({
    reducer: (x, y) => y ?? x,
  }),
  sourceUrl: Annotation<string | undefined>({
    reducer: (x, y) => y ?? x,
  }),
  config: Annotation<RunConfig>({
    reducer: (x, y) => y ?? x,
    default: () => ({
      audience: 'software engineers',
      tone: 'technical and precise',
      targetWords: 800,
    }),
  }),
  notes: Annotation<Note[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  researchRounds: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0,
  }),
  draft: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => '',
  }),
  claims: Annotation<Claim[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  writeCycles: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0,
  }),
  claimChecks: Annotation<ClaimCheck[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  editorVerdict: Annotation<EditorVerdict | undefined>({
    reducer: (x, y) => y ?? x,
  }),
  tokensUsed: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0,
  }),
  costUsd: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0,
  }),
  agentMetrics: Annotation<RunAgentMetrics>({
    reducer: (x, y) => mergeAgentMetrics(x, y),
    default: () => ({}),
  }),
  status: Annotation<RunStatus>({
    reducer: (x, y) => y ?? x,
    default: () => 'running',
  }),
  openIssues: Annotation<string[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  humanAction: Annotation<HumanAction | undefined>({
    reducer: (x, y) => y ?? x,
  }),
});
