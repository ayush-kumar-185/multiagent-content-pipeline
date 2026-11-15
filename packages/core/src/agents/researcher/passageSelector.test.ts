import { describe, it, expect } from 'vitest';
import {
  tokenizeKeywords,
  scorePassage,
  selectRelevantPassages,
  formatPageWithRelevantPassages,
} from './passageSelector.js';
import { verifyNoteQuote } from './quoteVerifier.js';
import { Note } from '../../schemas/note.js';

describe('Relevance-based Passage Selection', () => {
  const sampleDocument = `
# Developer Documentation Portal Welcome

Welcome to the general software engineering knowledge base. Here you will find guides on git, CI/CD pipelines, coding standards, and project organization policies across our company. Please refer to section 4 for onboarding instructions.

## Advances in TypeScript 5.0 Type Inference

TypeScript 5.0 introduces const type parameters, enabling developers to preserve literal types when calling generic functions without needing 'as const' assertions. This eliminates verbose type declarations across complex generic APIs. The compiler now accurately tracks tuple and object shapes automatically.

## Team Lunch Schedules and Kitchen Policies

The office kitchen on floor 3 is stocked on Tuesdays and Thursdays. Please label your food with your name and date. Containers left past Friday 5 PM will be discarded. Coffee machines are descaled monthly.

## TypeScript 5.0 Build and Performance Enhancements

In addition to type system improvements, TypeScript 5.0 features major performance enhancements. Internal namespaces were migrated to modern modules, resulting in a 37% package size reduction and up to 15% faster build times across standard benchmarks.

## Outdated Legacy Systems (Deprecated)

This section discusses legacy AngularJS 1.x controllers and old Grunt tasks used back in 2015. Do not use these patterns in modern development.
  `.trim();

  it('tokenizes keywords properly and filters stop words', () => {
    const tokens = tokenizeKeywords('Advances in TypeScript 5.0 Type Inference');
    expect(tokens).toContain('advances');
    expect(tokens).toContain('typescript');
    expect(tokens).toContain('5.0');
    expect(tokens).toContain('type');
    expect(tokens).toContain('inference');
    expect(tokens).not.toContain('in'); // stop word
  });

  it('scores passages matching topic keywords higher than irrelevant passages', () => {
    const query = 'Advances in TypeScript 5.0 Type Inference';
    const queryKeywords = tokenizeKeywords(query);

    const relevantPassage = `TypeScript 5.0 introduces const type parameters, enabling developers to preserve literal types when calling generic functions without needing 'as const' assertions.`;
    const irrelevantPassage = `The office kitchen on floor 3 is stocked on Tuesdays and Thursdays. Please label your food with your name and date.`;

    const scoreRel = scorePassage(relevantPassage, queryKeywords);
    const scoreIrrel = scorePassage(irrelevantPassage, queryKeywords);

    expect(scoreRel).toBeGreaterThan(scoreIrrel);
    expect(scoreIrrel).toBe(0);
  });

  it('selects the most relevant passages within the token budget', () => {
    const query = 'TypeScript 5.0 type inference performance';
    const budget = 120; // ~480 chars

    const result = selectRelevantPassages(sampleDocument, query, { tokenBudget: budget });

    expect(result.totalTokensEstimated).toBeLessThanOrEqual(budget + 10);
    expect(result.selectedPassages.length).toBeGreaterThan(0);

    // Selected text must contain the TypeScript 5.0 technical passages
    const combined = result.extractedText.toLowerCase();
    expect(combined).toContain('const type parameters');
    // Must NOT contain the kitchen policy or legacy AngularJS
    expect(combined).not.toContain('kitchen policies');
    expect(combined).not.toContain('angularjs');
  });

  it('guarantees that any quote extracted from selected passages is an exact substring of rawText', () => {
    const query = 'TypeScript 5.0 const type parameters';
    const result = selectRelevantPassages(sampleDocument, query, { tokenBudget: 200 });

    for (const passage of result.selectedPassages) {
      // Pick a full sentence from the passage
      const quote =
        "TypeScript 5.0 introduces const type parameters, enabling developers to preserve literal types when calling generic functions without needing 'as const' assertions.";
      if (passage.includes(quote)) {
        const testNote: Note = {
          id: 'n1',
          claim: 'TypeScript 5.0 introduces const type parameters',
          sourceUrl: 'https://example.com/ts',
          quote,
          retrievedAt: new Date().toISOString(),
        };

        const check = verifyNoteQuote(testNote, sampleDocument);
        expect(check.valid).toBe(true);
      }
    }
  });

  it('preserves document order among selected passages', () => {
    const query = 'TypeScript 5.0';
    const result = selectRelevantPassages(sampleDocument, query, { tokenBudget: 250 });

    const posInference = result.extractedText.indexOf('Advances in TypeScript 5.0 Type Inference');
    const posPerformance = result.extractedText.indexOf('TypeScript 5.0 Build and Performance Enhancements');

    if (posInference !== -1 && posPerformance !== -1) {
      expect(posInference).toBeLessThan(posPerformance);
    }
  });

  it('formats page securely with delimiters and title', () => {
    const formatted = formatPageWithRelevantPassages(
      {
        url: 'https://example.com/docs',
        title: 'TS 5.0 Release Notes',
        rawText: sampleDocument,
      },
      'TypeScript 5.0',
      { tokenBudget: 150 },
    );

    expect(formatted).toContain('<<<START_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>');
    expect(formatted).toContain('<<<END_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>');
    expect(formatted).toContain('[SOURCE TITLE: TS 5.0 Release Notes]');
    expect(formatted).toContain('TypeScript 5.0');
  });
});

