import { describe, it, expect } from 'vitest';
import { verifyNoteQuote, filterVerifiedNotes } from './quoteVerifier.js';
import { Note } from '../../schemas/note.js';

describe('Researcher: Exact-Substring Quote Verifier', () => {
  const sampleNote: Note = {
    id: 'n1',
    claim: 'TypeScript 5.0 introduced const type parameters.',
    sourceUrl: 'https://example.com/ts-5',
    quote: 'TypeScript 5.0 introduces const type parameters for improved inference.',
    retrievedAt: new Date().toISOString(),
  };

  it('validates exact verbatim substring quote', () => {
    const pageText =
      'Major release announcement: TypeScript 5.0 introduces const type parameters for improved inference. It also adds decorators.';
    const result = verifyNoteQuote(sampleNote, pageText);
    expect(result.valid).toBe(true);
  });

  it('validates quote with normalized whitespace differences', () => {
    const pageText = 'TypeScript 5.0 introduces const\n type parameters for\n  improved inference.';
    const result = verifyNoteQuote(sampleNote, pageText);
    expect(result.valid).toBe(true);
  });

  it('rejects and drops quote that does not exist in the source page text', () => {
    const pageText =
      'TypeScript 5.0 was released last year with various improvements and speedups.';
    const result = verifyNoteQuote(sampleNote, pageText);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('is not an exact substring');
  });

  it('filterVerifiedNotes filters out invalid quotes and retains verified ones', () => {
    const validNote: Note = {
      id: 'n1',
      claim: 'SIMD support in Postgres 16',
      sourceUrl: 'https://example.com/pg16',
      quote: 'PostgreSQL 16 uses SIMD CPU instructions for acceleration.',
      retrievedAt: new Date().toISOString(),
    };

    const invalidQuoteNote: Note = {
      id: 'n2',
      claim: 'Fabricated claim',
      sourceUrl: 'https://example.com/pg16',
      quote: 'This sentence never existed in the official release notes.',
      retrievedAt: new Date().toISOString(),
    };

    const missingPageNote: Note = {
      id: 'n3',
      claim: 'Unfetched page note',
      sourceUrl: 'https://example.com/never-fetched',
      quote: 'Some quote',
      retrievedAt: new Date().toISOString(),
    };

    const pageMap = new Map<string, string>();
    pageMap.set(
      'https://example.com/pg16',
      'Release Highlights: PostgreSQL 16 uses SIMD CPU instructions for acceleration. More details below.',
    );

    const filtered = filterVerifiedNotes([validNote, invalidQuoteNote, missingPageNote], pageMap);

    expect(filtered.verifiedNotes).toHaveLength(1);
    expect(filtered.verifiedNotes[0]?.id).toBe('n1');
    expect(filtered.droppedCount).toBe(2);
    expect(filtered.droppedNotes[0]?.reason).toContain('not an exact substring');
    expect(filtered.droppedNotes[1]?.reason).toContain('was not fetched');
  });
});
