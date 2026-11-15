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

  describe('Quote Expansion & Completeness Rules', () => {
    const fullPageText =
      'TypeScript 5.0 adds support for both of these forms: export type * from "module" and export type * as ns. TypeScript 5.0 is faster. In TypeScript 5.0, decorators are standardized.';

    it('expands quotes ending with a colon backwards to include the previous sentence ("adds support for both of these forms:" case)', () => {
      const tsReleasePage =
        'When TypeScript 3.8 introduced type-only imports, the new syntax wasn’t allowed on export * from "module" or export * as ns from "module" re-exports. TypeScript 5.0 adds support for both of these forms:\nts\nexport type * as vehicles from "./vehicles";';
      const colonNote: Note = {
        id: 'n4',
        claim: 'TypeScript 5.0 adds support for both of these forms',
        sourceUrl: 'https://example.com/ts-5',
        quote: 'TypeScript 5.0 adds support for both of these forms:',
        retrievedAt: new Date().toISOString(),
      };
      const result = verifyNoteQuote(colonNote, tsReleasePage);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('expanded');
      expect(result.expandedQuote).toBe(
        'When TypeScript 3.8 introduced type-only imports, the new syntax wasn’t allowed on export * from "module" or export * as ns from "module" re-exports. TypeScript 5.0 adds support for both of these forms:',
      );
      expect(tsReleasePage).toContain(result.expandedQuote!);
    });

    it('expands sentence fragments forwards to the sentence end', () => {
      const pageText =
        'Major release notes: In TypeScript 5.0, decorators are standardized across modern JavaScript and TypeScript runtimes. Additional tooling was updated.';
      const fragmentNote: Note = {
        id: 'n-fragment',
        claim: 'Decorators are standardized',
        sourceUrl: 'https://example.com/ts-5',
        quote: 'In TypeScript 5.0, decorators are standardized', // fragment ending mid-sentence
        retrievedAt: new Date().toISOString(),
      };
      const result = verifyNoteQuote(fragmentNote, pageText);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('expanded');
      expect(result.expandedQuote).toBe(
        'In TypeScript 5.0, decorators are standardized across modern JavaScript and TypeScript runtimes.',
      );
    });

    it('keeps already complete, well-formed sentences as "kept"', () => {
      const pageWithLong =
        'Major release notes: In TypeScript 5.0, decorators are standardized across modern JavaScript and TypeScript runtimes.';
      const longNote: Note = {
        id: 'n-long',
        claim: 'Decorators are standardized in TS 5.0',
        sourceUrl: 'https://example.com/ts-5',
        quote:
          'In TypeScript 5.0, decorators are standardized across modern JavaScript and TypeScript runtimes.',
        retrievedAt: new Date().toISOString(),
      };
      const result = verifyNoteQuote(longNote, pageWithLong);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('kept');
      expect(result.expandedQuote).toBeUndefined();
    });

    it('rejects quotes when expansion exceeds maximum words (RESEARCHER_MAX_QUOTE_WORDS default 60)', () => {
      const pageWithHugeSentence =
        'Long preamble sentence one. ' +
        'Very long preamble sentence two containing many descriptive technical clauses and adjectives to make it very wordy and extensive. ' +
        'TypeScript 5.0 adds support for both of these forms:';
      const colonNote: Note = {
        id: 'n-colon-huge',
        claim: 'TypeScript 5.0 forms',
        sourceUrl: 'https://example.com/ts-5',
        quote: 'TypeScript 5.0 adds support for both of these forms:',
        retrievedAt: new Date().toISOString(),
      };
      // with maxWords = 15: expansion has > 20 words so it must reject
      const result = verifyNoteQuote(colonNote, pageWithHugeSentence, 8, 15);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.reason).toContain('exceeding maximum allowed of 15');
    });

    it('rejects quotes when the quote does not exist in the source page text', () => {
      const ghostNote: Note = {
        id: 'n-ghost',
        claim: 'Ghost claim',
        sourceUrl: 'https://example.com/ts-5',
        quote: 'Non-existent quote that was never written in the document.',
        retrievedAt: new Date().toISOString(),
      };
      const result = verifyNoteQuote(ghostNote, fullPageText);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.reason).toContain('is not an exact substring');
    });

    it('filterVerifiedNotes updates note.quote for expanded notes and audits decisions', () => {
      const tsReleasePage =
        'When TypeScript 3.8 introduced type-only imports, the new syntax wasn’t allowed on export * from "module" or export * as ns from "module" re-exports. TypeScript 5.0 adds support for both of these forms:\nts\nexport type * as vehicles from "./vehicles";';
      const noteToExpand: Note = {
        id: 'n4',
        claim: 'TypeScript 5.0 forms',
        sourceUrl: 'https://example.com/ts-5',
        quote: 'TypeScript 5.0 adds support for both of these forms:',
        retrievedAt: new Date().toISOString(),
      };
      const alreadyCompleteNote: Note = {
        id: 'n2',
        claim: 'TypeScript 5.0 extends',
        sourceUrl: 'https://example.com/ts-5',
        quote: 'When TypeScript 3.8 introduced type-only imports, the new syntax wasn’t allowed on export * from "module" or export * as ns from "module" re-exports.',
        retrievedAt: new Date().toISOString(),
      };

      const pageMap = new Map<string, string>([['https://example.com/ts-5', tsReleasePage]]);
      const filterResult = filterVerifiedNotes([noteToExpand, alreadyCompleteNote], pageMap);

      expect(filterResult.verifiedNotes).toHaveLength(2);
      expect(filterResult.noteAudits).toHaveLength(2);

      const audit1 = filterResult.noteAudits.find((a) => a.noteId === 'n4');
      expect(audit1?.status).toBe('expanded');
      expect(audit1?.finalQuote).toContain('When TypeScript 3.8 introduced');

      const audit2 = filterResult.noteAudits.find((a) => a.noteId === 'n2');
      expect(audit2?.status).toBe('kept');
    });
  });
});
