import { describe, it, expect } from 'vitest';
import {
  countWords,
  countSyllablesInWord,
  calculateReadability,
  runDeterministicEditorChecks,
} from './deterministicChecks.js';

describe('Editor: Deterministic Checks', () => {
  it('correctly counts words in markdown text', () => {
    const text = '# Title\n\nThis is a sample technical paragraph with **bold** words.';
    expect(countWords(text)).toBe(10);
  });

  it('correctly counts syllables in English words', () => {
    expect(countSyllablesInWord('the')).toBe(1);
    expect(countSyllablesInWord('program')).toBe(2);
    expect(countSyllablesInWord('compiler')).toBe(3);
    expect(countSyllablesInWord('architecture')).toBe(4);
  });

  it('computes Flesch reading score and grade levels', () => {
    const easyText = 'The cat sat on the mat. It was a good day. The sun was hot.';
    const easyRead = calculateReadability(easyText);
    expect(easyRead.fleschScore).toBeGreaterThan(70);

    const complexText =
      'Polymorphic instantiation mechanisms necessitate sophisticated algorithmic heuristics within optimizing compilers to synthesize deterministic bytecode.';
    const complexRead = calculateReadability(complexText);
    expect(complexRead.fleschScore).toBeLessThan(40);
  });

  it('flags articles that deviate drastically from target word count', () => {
    const shortDraft = 'Too short of a draft.';
    const report = runDeterministicEditorChecks(shortDraft, [], {
      audience: 'engineers',
      tone: 'technical',
      targetWords: 800,
    });
    expect(report.lengthPassed).toBe(false);
    expect(report.summary).toContain('Length check FLAGGED');
  });

  it('passes articles within acceptable range and with good citation coverage', () => {
    const mockDraft = `
TypeScript 5.0 introduced const type parameters [n1].
Decorators were also stabilized in this release [n2].
This greatly improved type safety across enterprise projects [n3].
`;
    const claims = [
      { id: 'c1', claim: 'TypeScript 5.0 introduced const type parameters', noteIds: ['n1'] },
      { id: 'c2', claim: 'Decorators were also stabilized in this release', noteIds: ['n2'] },
      {
        id: 'c3',
        claim: 'This greatly improved type safety across enterprise projects',
        noteIds: ['n3'],
      },
    ];

    const report = runDeterministicEditorChecks(mockDraft, claims, {
      audience: 'engineers',
      tone: 'technical',
      targetWords: 20, // small target for test
    });

    expect(report.lengthPassed).toBe(true);
    expect(report.citationPassed).toBe(true);
    expect(report.citationCoverageRatio).toBeGreaterThan(0.5);
  });
});
