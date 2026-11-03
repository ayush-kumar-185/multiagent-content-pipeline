import type { Note, Claim, ClaimCheck, EditorVerdict, RunConfig } from '@citewriter/core';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_review'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'budget_exceeded';

export interface RunRecord {
  id: string;
  userId: string;
  topic: string;
  sourceUrl?: string | null;
  config: RunConfig;
  status: RunStatus;
  draft: string;
  claims: Claim[];
  claimChecks: ClaimCheck[];
  editorVerdict?: EditorVerdict | null;
  notes: Note[];
  researchRounds: number;
  writeCycles: number;
  openIssues: string[];
  tokensUsed: number;
  costUsd: number;
  agentMetrics?: Record<string, { tokensUsed: number; costUsd: number; calls: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface RunEventPayload {
  id: number;
  runId: string;
  sequence: number;
  type: string;
  node?: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string | null;
  role: string;
}

export type { Note, Claim, ClaimCheck, EditorVerdict, RunConfig };
