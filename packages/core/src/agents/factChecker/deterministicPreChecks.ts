import { Claim, ClaimCheck } from '../../schemas/claim.js';
import { Note } from '../../schemas/note.js';

export interface PreCheckResult {
  passed: boolean;
  claimCheck?: ClaimCheck;
}

/**
 * Extracts numeric literals (integers, decimals, percentages, currency, year dates) from text.
 */
export function extractNumbers(text: string): string[] {
  // Matches patterns like: 37%, 5.0, 100, 2023, $50, 1,000, 0.25
  const regex = /(?:[$€£])?\b\d+(?:,\d{3})*(?:\.\d+)?%?(?!\w)/g;
  const matches = text.match(regex);
  if (!matches) return [];

  // Normalize: remove currency symbols and commas for comparison
  return matches.map((m) => m.replace(/[$€£,]/g, '').trim()).filter(Boolean);
}

/**
 * Deterministic pre-checks before any LLM call:
 * 1. Every cited note ID exists in the collected research notes.
 * 2. Every number in the claim appears in the cited quote(s).
 */
export function runDeterministicFactPreChecks(claim: Claim, notes: Note[]): PreCheckResult {
  const notesMap = new Map<string, Note>();
  for (const n of notes) {
    notesMap.set(n.id, n);
  }

  // 1. Note Existence Check
  for (const noteId of claim.noteIds) {
    if (!notesMap.has(noteId)) {
      return {
        passed: false,
        claimCheck: {
          claim: claim.claim,
          noteIds: claim.noteIds,
          status: 'unsupported',
          reason: `Deterministic check failed: Cited note ID "[${noteId}]" does not exist in collected research notes.`,
        },
      };
    }
  }

  // 2. Number Verification against cited quotes
  const claimNumbers = extractNumbers(claim.claim);

  if (claimNumbers.length > 0) {
    // Gather all quote text from the cited notes
    const citedQuotesText = claim.noteIds.map((id) => notesMap.get(id)?.quote ?? '').join(' ');

    const normalizedQuoteText = citedQuotesText.replace(/,/g, '');

    for (const num of claimNumbers) {
      // Check if num is a substring of the combined quote text
      // Handles both "37%" and "37", as well as floating point "5.0"
      const numWithoutPercent = num.replace('%', '');
      const hasNumber =
        normalizedQuoteText.includes(num) || normalizedQuoteText.includes(numWithoutPercent);

      if (!hasNumber) {
        return {
          passed: false,
          claimCheck: {
            claim: claim.claim,
            noteIds: claim.noteIds,
            status: 'unsupported',
            reason: `Deterministic check failed: Number "${num}" in claim does not appear in cited note quote(s).`,
          },
        };
      }
    }
  }

  return { passed: true };
}
