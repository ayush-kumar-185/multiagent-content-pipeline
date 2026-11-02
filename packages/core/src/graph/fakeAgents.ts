import { Note, NoteSchema } from '../schemas/note.js';
import { Claim, ClaimCheck, ClaimCheckSchema } from '../schemas/claim.js';
import { EditorVerdict, EditorVerdictSchema } from '../schemas/editor.js';

export interface FakeAgentOptions {
  researcherBehavior?: (round: number) => Note[];
  writerBehavior?: (cycle: number, notes: Note[]) => { draft: string; claims: Claim[] };
  factCheckerBehavior?: (claims: Claim[], notes: Note[]) => ClaimCheck[];
  editorBehavior?: (draft: string, claims: Claim[], cycle: number) => EditorVerdict;
}

export const defaultFakeNotes: Note[] = [
  NoteSchema.parse({
    id: 'n1',
    claim: 'TypeScript 5.0 introduced const type parameters for improved inference.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote: 'TypeScript 5.0 introduces const type parameters.',
    retrievedAt: '2026-01-01T00:00:00.000Z',
  }),
  NoteSchema.parse({
    id: 'n2',
    claim: 'Decorators reached Stage 3 and were standardized in TypeScript 5.0.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote: 'Decorators are a Stage 3 feature coming to ECMAScript.',
    retrievedAt: '2026-01-01T00:00:00.000Z',
  }),
];

export const defaultFakeDraft = `# TypeScript 5.0 Advancements

TypeScript 5.0 introduces const type parameters for improved inference [n1].
Decorators have reached Stage 3 and are now fully supported [n2].`;

export const defaultFakeClaims: Claim[] = [
  {
    id: 'c1',
    claim: 'TypeScript 5.0 introduces const type parameters for improved inference.',
    noteIds: ['n1'],
  },
  {
    id: 'c2',
    claim: 'Decorators have reached Stage 3 and are now fully supported.',
    noteIds: ['n2'],
  },
];

export const defaultFakeClaimChecks: ClaimCheck[] = [
  ClaimCheckSchema.parse({
    claim: 'TypeScript 5.0 introduces const type parameters for improved inference.',
    noteIds: ['n1'],
    status: 'supported',
    reason: 'Verified against primary TypeScript announcement notes.',
  }),
  ClaimCheckSchema.parse({
    claim: 'Decorators have reached Stage 3 and are now fully supported.',
    noteIds: ['n2'],
    status: 'supported',
    reason: 'Verified against ECMAScript stage notes.',
  }),
];

export const defaultFakeEditorVerdict: EditorVerdict = EditorVerdictSchema.parse({
  score: 9.0,
  feedback: 'Concise, clear, and every factual statement carries accurate citations.',
  decision: 'accept',
});
