import { describe, it, expect } from 'vitest';
import {
  deduplicateNotes,
  areQuotesDuplicate,
  normalizeQuote,
  normalizeUrl,
} from './noteDeduplication.js';
import { Note } from '../../schemas/note.js';

describe('Note Deduplication', () => {
  it('normalizes quotes by lowercasing and collapsing whitespace', () => {
    const raw = '  TypeScript 5.0  manages to make\n\tall enums into union enums. ';
    expect(normalizeQuote(raw)).toBe('typescript 5.0 manages to make all enums into union enums.');
  });

  it('normalizes URLs by lowercasing, stripping protocol and trailing slash', () => {
    expect(normalizeUrl('https://TypeScriptLang.org/docs/handbook/')).toBe(
      'typescriptlang.org/docs/handbook',
    );
    expect(normalizeUrl('http://typescriptlang.org/docs/handbook')).toBe(
      'typescriptlang.org/docs/handbook',
    );
  });

  it('detects duplicate on exact normalized quote match regardless of casing or whitespace', () => {
    const noteA = {
      quote: 'TypeScript 5.0 introduces const type parameters.',
      sourceUrl: 'https://example.com/source-a',
    };
    const noteB = {
      quote: '  typescript 5.0   introduces const type parameters.  ',
      sourceUrl: 'https://example.com/source-b',
    };
    const check = areQuotesDuplicate(noteA, noteB);
    expect(check.isDuplicate).toBe(true);
    expect(check.reason).toContain('Exact normalized quote match');
  });

  it('detects duplicate on heavy overlap when source URLs match', () => {
    const noteA = {
      quote: 'PostgreSQL 16 introduces bidirectional logical replication between instances.',
      sourceUrl: 'https://example.com/pg16-release',
    };
    // Substring containment on same source
    const noteB = {
      quote: 'PostgreSQL 16 introduces bidirectional logical replication between instances for distributed databases.',
      sourceUrl: 'https://example.com/pg16-release',
    };
    const checkSub = areQuotesDuplicate(noteA, noteB);
    expect(checkSub.isDuplicate).toBe(true);
    expect(checkSub.reason).toContain('matching source URL');

    // Over 75% token overlap on same source
    const noteC = {
      quote: 'PostgreSQL 16 introduces bidirectional logical replication across instances and nodes.',
      sourceUrl: 'https://example.com/pg16-release',
    };
    const checkToken = areQuotesDuplicate(noteA, noteC);
    expect(checkToken.isDuplicate).toBe(true);
    expect(checkToken.reason).toContain('matching source URL');
  });

  it('does not flag distinct quotes on different URLs as duplicates', () => {
    const noteA = {
      quote: 'TypeScript 5.0 treats all enums as union enums.',
      sourceUrl: 'https://typescriptlang.org/release-notes/5.0',
    };
    const noteB = {
      quote: 'TypeScript 5.0 introduces the verbatimModuleSyntax flag.',
      sourceUrl: 'https://typescriptlang.org/release-notes/5.0',
    };
    const check = areQuotesDuplicate(noteA, noteB);
    expect(check.isDuplicate).toBe(false);
  });

  it('deduplicates notes including the case where n5 and n6 duplicated n1 and n2', () => {
    const existingNotes: Note[] = [
      {
        id: 'n1',
        claim: 'TypeScript 5.0 treats all enums as union enums.',
        sourceUrl: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
        quote:
          'TypeScript 5.0 manages to make all enums into union enums by creating a unique type for each computed member.',
        retrievedAt: '2026-11-15T10:00:00.000Z',
      },
      {
        id: 'n2',
        claim: 'TypeScript 5.0 introduces --verbatimModuleSyntax.',
        sourceUrl: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
        quote:
          'TypeScript 5.0 introduces a new option called --verbatimModuleSyntax to simplify the situation.',
        retrievedAt: '2026-11-15T10:00:00.000Z',
      },
      {
        id: 'n3',
        claim: 'Bundler module resolution option improves compatibility.',
        sourceUrl: 'https://www.geeksforgeeks.org/typescript/typescript-5-0-updates',
        quote:
          'TypeScript 5.0 introduces a new bundler module resolution option that improves compatibility with modern bundlers like Webpack and Parcel.',
        retrievedAt: '2026-11-15T10:00:00.000Z',
      },
      {
        id: 'n4',
        claim: 'Hybrid enum type combines numeric and literal enums.',
        sourceUrl: 'https://blog.logrocket.com/exploring-typescript-5-features',
        quote:
          'TypeScript 5 introduces a hybrid enum type that has the best of both numeric enums and literal enums.',
        retrievedAt: '2026-11-15T10:00:00.000Z',
      },
    ];

    // Candidate notes from re-research round (e.g. n5, n6, n7)
    const incomingNotes = [
      {
        id: 'n5',
        claim: 'All enums are union enums in TypeScript 5.0.',
        sourceUrl: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
        quote:
          'TypeScript 5.0 manages to make all enums into union enums by creating a unique type for each computed member.',
        retrievedAt: '2026-11-15T10:01:00.000Z',
      },
      {
        id: 'n6',
        claim: 'New verbatimModuleSyntax flag simplifies imports.',
        sourceUrl: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
        quote:
          'TypeScript 5.0 introduces a new option called --verbatimModuleSyntax to simplify the situation.',
        retrievedAt: '2026-11-15T10:01:00.000Z',
      },
      {
        id: 'n7',
        claim: 'TypeScript 5.0 introduced const type parameters.',
        sourceUrl: 'https://www.geeksforgeeks.org/typescript/typescript-5-0-updates',
        quote:
          'TypeScript 5.0 introduced const type parameters, which enhance the way TypeScript infers types, making it more specific.',
        retrievedAt: '2026-11-15T10:01:00.000Z',
      },
    ];

    const result = deduplicateNotes(existingNotes, incomingNotes);

    // n5 and n6 must be dropped because they duplicate n1 and n2
    expect(result.droppedNotes.length).toBe(2);
    expect(result.droppedNotes[0]?.matchedNoteId).toBe('n1');
    expect(result.droppedNotes[1]?.matchedNoteId).toBe('n2');

    // Existing notes keep their original IDs
    expect(result.mergedNotes.find((n) => n.id === 'n1')).toBeDefined();
    expect(result.mergedNotes.find((n) => n.id === 'n2')).toBeDefined();
    expect(result.mergedNotes.find((n) => n.id === 'n3')).toBeDefined();
    expect(result.mergedNotes.find((n) => n.id === 'n4')).toBeDefined();

    // The genuine new note (candidate n7) is kept and appended with next ID
    expect(result.mergedNotes.length).toBe(5);
    const addedNote = result.mergedNotes[4]!;
    expect(addedNote.claim).toContain('const type parameters');
    expect(addedNote.id).toBe('n5');
  });
});
