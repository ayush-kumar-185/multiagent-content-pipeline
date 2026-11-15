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
  NoteSchema.parse({
    id: 'n3',
    claim: 'All enums are treated as union enums in TypeScript 5.0.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote: 'TypeScript 5.0 improves enums by treating all enums as union enums.',
    retrievedAt: '2026-01-01T00:00:00.000Z',
  }),
  NoteSchema.parse({
    id: 'n4',
    claim: 'TypeScript 5.0 introduces a new bundler module resolution option.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote: 'TypeScript 5.0 introduces a new bundler module resolution option.',
    retrievedAt: '2026-01-01T00:00:00.000Z',
  }),
  NoteSchema.parse({
    id: 'n5',
    claim: 'TypeScript 5.0 allows multiple extends in configuration files.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote: 'TypeScript 5.0 allows multiple entries in the extends field.',
    retrievedAt: '2026-01-01T00:00:00.000Z',
  }),
];

export function generateFakeDraft(topic: string = 'TypeScript 5.0 Advancements'): string {
  const cleanTopic = topic || 'TypeScript 5.0 Advancements';
  return `# ${cleanTopic}

${cleanTopic} introduces several fundamental advancements for modern software engineering architectures [n1]. Developers can leverage these core ${cleanTopic} capabilities to ensure deterministic type safety and modular isolation across large-scale codebases [n1]. The underlying mechanisms ensure that literal structures and semantic definitions are strictly preserved throughout compilation [n1]. Engineering teams can build robust foundations with predictable typing behavior across all execution environments [n1].

## Structural Architecture and Modernization

Furthermore, ${cleanTopic} standardizes component specifications to align directly with modern ecosystem standards [n2]. Teams can implement clean annotations across classes, methods, accessors, and fields without introducing runtime overhead [n2]. This architectural consistency eliminates historical ambiguities between disparate compiler subsystems [n2]. As a result, static analysis tools can evaluate class definitions with unprecedented precision and zero ambiguity [n2].

## Comprehensive System Integration

The unified type system in ${cleanTopic} handles complex expressions and computed structures with consistent evaluation semantics [n3]. By establishing discrete literal representations, type checking behavior becomes fully predictable in generic and polymorphic contexts [n3]. This resolves long-standing discrepancies in configuration management [n3]. Developers gain clear diagnostic feedback during refactoring and interface refinement across diverse modules [n3].

## Build and Module Configuration

Additionally, ${cleanTopic} introduces modern module resolution strategies designed specifically for contemporary bundlers and build tools [n4]. Build pipelines utilizing modern bundlers experience seamless interoperability and accurate path resolution [n4]. The compilation step completes with minimal configuration overhead and maximum developer productivity [n4].

Furthermore, the system enables flexible composition of configuration files across distributed projects and multi-package workspaces [n5]. Organizations can inherit foundational settings without cumbersome manual duplication [n5]. Together, these advancements ensure that ${cleanTopic} delivers high reliability, maintainability, and precision across enterprise platforms [n5].`;
}

export const defaultFakeDraft = generateFakeDraft('TypeScript 5.0 Advancements');

export const defaultFakeClaims: Claim[] = [
  {
    id: 'c1',
    claim: 'TypeScript 5.0 introduces const type parameters for improved inference across generic functions.',
    noteIds: ['n1'],
  },
  {
    id: 'c2',
    claim: 'Developers can add a const modifier to a type parameter declaration to enable const-like type inference by default.',
    noteIds: ['n1'],
  },
  {
    id: 'c3',
    claim: 'Decorators have reached Stage 3 and are now fully supported in TypeScript 5.0.',
    noteIds: ['n2'],
  },
  {
    id: 'c4',
    claim: 'All enums are treated as union enums in TypeScript 5.0.',
    noteIds: ['n3'],
  },
  {
    id: 'c5',
    claim: 'TypeScript 5.0 introduces a new bundler module resolution option.',
    noteIds: ['n4'],
  },
  {
    id: 'c6',
    claim: 'TypeScript 5.0 allows multiple extends in configuration files.',
    noteIds: ['n5'],
  },
];

export const defaultFakeClaimChecks: ClaimCheck[] = [
  ClaimCheckSchema.parse({
    claim: 'TypeScript 5.0 introduces const type parameters for improved inference across generic functions.',
    noteIds: ['n1'],
    status: 'supported',
    reason: 'Verified against primary TypeScript announcement notes.',
  }),
  ClaimCheckSchema.parse({
    claim: 'Developers can add a const modifier to a type parameter declaration to enable const-like type inference by default.',
    noteIds: ['n1'],
    status: 'supported',
    reason: 'Verified against primary TypeScript announcement notes.',
  }),
  ClaimCheckSchema.parse({
    claim: 'Decorators have reached Stage 3 and are now fully supported in TypeScript 5.0.',
    noteIds: ['n2'],
    status: 'supported',
    reason: 'Verified against ECMAScript stage notes.',
  }),
  ClaimCheckSchema.parse({
    claim: 'All enums are treated as union enums in TypeScript 5.0.',
    noteIds: ['n3'],
    status: 'supported',
    reason: 'Verified against union enum documentation.',
  }),
  ClaimCheckSchema.parse({
    claim: 'TypeScript 5.0 introduces a new bundler module resolution option.',
    noteIds: ['n4'],
    status: 'supported',
    reason: 'Verified against bundler module resolution specifications.',
  }),
  ClaimCheckSchema.parse({
    claim: 'TypeScript 5.0 allows multiple extends in configuration files.',
    noteIds: ['n5'],
    status: 'supported',
    reason: 'Verified against tsconfig extends specifications.',
  }),
];

export const defaultFakeEditorVerdict: EditorVerdict = EditorVerdictSchema.parse({
  score: 9.0,
  feedback: 'Concise, clear, and every factual statement carries accurate citations.',
  decision: 'accept',
});
