import { describe, it, expect } from 'vitest';
import { parseCitationsFromDraft } from './citationParser.js';

describe('Writer: Citation Parser', () => {
  it('parses single citations [n1] from sentences', () => {
    const draft = `
# Article Title

TypeScript 5.0 introduced const type parameters for improved inference [n1].
It was released in March 2023 [n2].
`;
    const claims = parseCitationsFromDraft(draft);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual({
      id: 'c1',
      claim: 'TypeScript 5.0 introduced const type parameters for improved inference.',
      noteIds: ['n1'],
    });
    expect(claims[1]).toEqual({
      id: 'c2',
      claim: 'It was released in March 2023.',
      noteIds: ['n2'],
    });
  });

  it('parses multiple citations like [n1][n2] and [n1, n2]', () => {
    const draft = `
Both TypeScript and ECMAScript standardized decorators [n1][n2].
Another feature was also shipped simultaneously [n3, n4].
`;
    const claims = parseCitationsFromDraft(draft);
    expect(claims).toHaveLength(2);
    expect(claims[0]?.noteIds).toEqual(['n1', 'n2']);
    expect(claims[1]?.noteIds).toEqual(['n3', 'n4']);
  });

  it('ignores markdown headers and non-factual sentences without citations', () => {
    const draft = `
# Section Header
## Subheader

In this article we explore modern compilers.
TypeScript compiler performance improved by 10% [n1].
Let us conclude our findings.
`;
    const claims = parseCitationsFromDraft(draft);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.claim).toBe('TypeScript compiler performance improved by 10%.');
    expect(claims[0]?.noteIds).toEqual(['n1']);
  });

  it('handles empty or blank drafts gracefully', () => {
    expect(parseCitationsFromDraft('')).toEqual([]);
    expect(parseCitationsFromDraft('   \n\n  ')).toEqual([]);
  });
});
