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
  // 1. Strip leading structural thread numbers (e.g. "1/", "1/8", "1."), list numbers, or prefixes
  const sanitized = text
    .replace(/^(?:(?:Fact|Tip|Step|Item|Point)\s+)?\d+[/.)\]:]\s*/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\b\d+\/\d+\b/g, '') // ignore tweet counter fractions like 1/7, 2/7
    .trim();

  // Matches patterns like: 37%, 5.0, 100, 2023, $50, 1,000, 0.25
  const regex = /(?:[$€£])?\b\d+(?:,\d{3})*(?:\.\d+)?%?(?!\w)/g;
  const matches = sanitized.match(regex);
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

export interface SentenceCitationCheck {
  sentence: string;
  hasCitation: boolean;
  endsCitation: boolean;
  noteIds: string[];
  validNoteIds: string[];
  invalidNoteIds: string[];
  isValid: boolean;
  reason?: string;
}

/**
 * Checks whether a single body sentence ends with at least one valid citation marker
 * referencing an existing note ID.
 */
export function checkSentenceCitation(
  sentence: string,
  existingNoteIds: Set<string>,
): SentenceCitationCheck {
  const trimmed = sentence.trim();
  if (!trimmed) {
    return {
      sentence: trimmed,
      hasCitation: false,
      endsCitation: false,
      noteIds: [],
      validNoteIds: [],
      invalidNoteIds: [],
      isValid: true,
    };
  }

  // Regex to check if sentence ends with one or more citation blocks [n1], [n1][n2], [n1, n2],
  // optionally preceded or followed by terminal punctuation (. ! ?)
  const endCitationRegex = /(?:[.!?]?\s*\[n\d+(?:\s*,\s*n\d+)*\]\s*)+[.!?]?$/;

  if (!endCitationRegex.test(trimmed)) {
    const hasAnyCitation = /\[n\d+(?:\s*,\s*n\d+)*\]/.test(trimmed);
    return {
      sentence: trimmed,
      hasCitation: hasAnyCitation,
      endsCitation: false,
      noteIds: [],
      validNoteIds: [],
      invalidNoteIds: [],
      isValid: false,
      reason: hasAnyCitation
        ? 'Sentence does not end with a citation marker (citation must be placed at the end of the sentence).'
        : 'Sentence has no citation marker (every factual sentence must end with a citation to a note).',
    };
  }

  // Extract all note IDs from the ending citation block
  const endingBlockMatch = trimmed.match(endCitationRegex);
  const endingBlock = endingBlockMatch ? endingBlockMatch[0] : '';
  const idMatches = Array.from(endingBlock.matchAll(/n\d+/g)).map((m) => m[0]);

  const validNoteIds: string[] = [];
  const invalidNoteIds: string[] = [];

  for (const id of idMatches) {
    if (existingNoteIds.has(id)) {
      validNoteIds.push(id);
    } else {
      invalidNoteIds.push(id);
    }
  }

  if (invalidNoteIds.length > 0) {
    return {
      sentence: trimmed,
      hasCitation: true,
      endsCitation: true,
      noteIds: idMatches,
      validNoteIds,
      invalidNoteIds,
      isValid: false,
      reason: `Citation references non-existent note ID(s): ${invalidNoteIds.map((id) => `[${id}]`).join(', ')}.`,
    };
  }

  return {
    sentence: trimmed,
    hasCitation: true,
    endsCitation: true,
    noteIds: validNoteIds,
    validNoteIds,
    invalidNoteIds: [],
    isValid: true,
  };
}

/**
 * Deterministic check scanning all body sentences in a draft (excluding headings and dividers).
 * Any body sentence that does not end with a valid citation marker to an existing note is flagged as unsupported.
 */
export function findUncitedSentencesInDraft(draft: string, notes: Note[]): ClaimCheck[] {
  const existingNoteIds = new Set(notes.map((n) => n.id));
  const checks: ClaimCheck[] = [];

  const lines = draft.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Headings, titles, dividers, empty lines are exempt
    if (!line || line.startsWith('#') || line.startsWith('---') || line.startsWith('===')) {
      continue;
    }

    const sentences = line
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const check = checkSentenceCitation(sentence, existingNoteIds);
      if (!check.isValid) {
        checks.push({
          claim: sentence,
          noteIds: check.validNoteIds,
          status: 'unsupported',
          reason: `Deterministic check failed: ${check.reason}`,
        });
      }
    }
  }

  return checks;
}
