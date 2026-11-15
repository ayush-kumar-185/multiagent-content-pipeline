import { describe, it, expect } from 'vitest';
import {
  evaluateCoverageGate,
  extractTopicKeyTerms,
  stemWord,
  matchKeyTermInText,
} from './coverageGate.js';
import { Note } from '../schemas/note.js';

describe('Coverage Gate: Deterministic Thinness Evaluation', () => {
  const dummyNotes: Note[] = Array.from({ length: 5 }, (_, i) => ({
    id: `n${i + 1}`,
    claim: `Claim ${i + 1}`,
    sourceUrl: 'https://example.com',
    quote: `Quote for claim ${i + 1} that is long enough.`,
    retrievedAt: new Date().toISOString(),
  }));

  const sampleTopic = 'Advances in TypeScript 5.0 Type Inference';
  const validBody = Array(30).fill('TypeScript 5.0 type inference provides literal inference [n1].').join(' ');

  describe('Word Stemming and Lemma Normalization (stemWord)', () => {
    it('stems all inflectional and derivational forms of "inference" to the same root', () => {
      expect(stemWord('inference')).toBe('infer');
      expect(stemWord('inferences')).toBe('infer');
      expect(stemWord('infer')).toBe('infer');
      expect(stemWord('infers')).toBe('infer');
      expect(stemWord('inferred')).toBe('infer');
      expect(stemWord('inferring')).toBe('infer');
    });

    it('stems all forms of "type" to the same root', () => {
      expect(stemWord('type')).toBe('typ');
      expect(stemWord('types')).toBe('typ');
      expect(stemWord('typed')).toBe('typ');
      expect(stemWord('typing')).toBe('typ');
    });

    it('stems other technical terms consistently', () => {
      expect(stemWord('connection')).toBe('connect');
      expect(stemWord('connections')).toBe('connect');
      expect(stemWord('migration')).toBe('migrat');
      expect(stemWord('migrates')).toBe('migrat');
      expect(stemWord('migrating')).toBe('migrat');
    });
  });

  describe('Key Term Matching by Word Stem or Lemma (matchKeyTermInText)', () => {
    it('satisfies term "type inference" with "const type parameters enhance the way TypeScript infers types"', () => {
      const sentence = 'const type parameters enhance the way TypeScript infers types';
      const matched = matchKeyTermInText('type inference', sentence);
      expect(matched).toBe(true);
    });

    it('matches case-insensitively and regardless of phrase ordering', () => {
      expect(
        matchKeyTermInText('type inference', 'The compiler INFERRED the specific literal TYPE accurately.'),
      ).toBe(true);
      expect(
        matchKeyTermInText('TYPE INFERENCE', 'TypeScript infers the return type automatically.'),
      ).toBe(true);
    });

    it('returns false when any constituent stem is missing', () => {
      // Has "type", missing "infer"
      expect(
        matchKeyTermInText('type inference', 'TypeScript 5.0 introduces const type parameters for declarations.'),
      ).toBe(false);

      // Has "infer", missing "type"
      expect(
        matchKeyTermInText('type inference', 'The algorithm infers values based on input context.'),
      ).toBe(false);
    });
  });

  describe('extractTopicKeyTerms', () => {
    it('extracts technical 2-grams and strips generic prefixes', () => {
      const terms1 = extractTopicKeyTerms('Advances in TypeScript 5.0 Type Inference');
      expect(terms1).toContain('type inference');

      const terms2 = extractTopicKeyTerms('HTTP/3 QUIC protocol connection migration performance');
      expect(terms2).toContain('connection migration');
    });

    it('handles empty or short topics gracefully', () => {
      expect(extractTopicKeyTerms('')).toEqual([]);
      expect(extractTopicKeyTerms('   ')).toEqual([]);
    });
  });

  describe('evaluateCoverageGate conditions', () => {
    it('BRANCH 1 (Thin notes): flags as thin when notes count is below MIN_NOTES (5)', () => {
      const fewNotes = dummyNotes.slice(0, 3); // 3 notes < 5
      const res = evaluateCoverageGate(sampleTopic, fewNotes, validBody, {
        minNotes: 5,
        minWords: 250,
      });

      expect(res.isThin).toBe(true);
      expect(res.reasons.some((r) => r.includes('Fewer than MIN_NOTES'))).toBe(true);
      expect(res.instruction).toContain('The current coverage is thin');
    });

    it('BRANCH 2 (Thin word count): flags as thin when draft body is below MIN_WORDS (250)', () => {
      const shortBody = 'Short draft body with type inference [n1].'; // ~7 words
      const res = evaluateCoverageGate(sampleTopic, dummyNotes, shortBody, {
        minNotes: 5,
        minWords: 250,
      });

      expect(res.isThin).toBe(true);
      expect(res.reasons.some((r) => r.includes('Draft body word count'))).toBe(true);
      expect(res.wordCount).toBeLessThan(250);
    });

    it('BRANCH 3 (Missing key terms): flags as thin when topic key term ("type inference") is absent from body', () => {
      // 300 words without the phrase "type inference"
      const bodyWithoutKeyTerms = Array(30)
        .fill('TypeScript 5.0 allows multiple extends entries in configuration files [n1].')
        .join(' ');

      const res = evaluateCoverageGate(sampleTopic, dummyNotes, bodyWithoutKeyTerms, {
        minNotes: 5,
        minWords: 250,
      });

      expect(res.isThin).toBe(true);
      expect(res.missingKeyTerms).toContain('type inference');
      expect(res.reasons.some((r) => r.includes('Topic key terms missing'))).toBe(true);
    });

    it('BRANCH 4 (Passed): passes when notes >= 5, body words >= 250, and key terms are present', () => {
      const res = evaluateCoverageGate(sampleTopic, dummyNotes, validBody, {
        minNotes: 5,
        minWords: 250,
      });

      expect(res.isThin).toBe(false);
      expect(res.reasons).toHaveLength(0);
      expect(res.missingKeyTerms).toHaveLength(0);
      expect(res.instruction).toBeUndefined();
    });

    it('satisfies key terms check in evaluateCoverageGate via stemmed sentence', () => {
      // Body has 260 words and contains "const type parameters enhance the way TypeScript infers types"
      const stemmedSentence = 'In TypeScript 5.0, const type parameters enhance the way TypeScript infers types [n1].';
      const bodyWithStemmedTerms = Array(20).fill(stemmedSentence).join(' ');

      const res = evaluateCoverageGate(sampleTopic, dummyNotes, bodyWithStemmedTerms, {
        minNotes: 5,
        minWords: 250,
      });

      expect(res.missingKeyTerms).toHaveLength(0);
      expect(res.isThin).toBe(false);
    });

    it('exempts markdown headings and dividers from body word count', () => {
      const draftWithHeadingsOnly = `
# Title
## Heading 1
### Heading 2
---
===
      `;
      const res = evaluateCoverageGate(sampleTopic, dummyNotes, draftWithHeadingsOnly, {
        minNotes: 5,
        minWords: 10,
      });
      expect(res.wordCount).toBe(0);
      expect(res.isThin).toBe(true);
    });
  });
});

