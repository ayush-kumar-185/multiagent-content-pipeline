import { Note } from '../../schemas/note.js';

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

export interface QuoteVerificationResult {
  valid: boolean;
  status: 'kept' | 'expanded' | 'rejected';
  reason?: string;
  expandedQuote?: string;
}

export interface NoteAuditEntry {
  noteId: string;
  status: 'kept' | 'expanded' | 'rejected';
  originalQuote: string;
  finalQuote: string;
  reason?: string;
}

/**
 * Deterministically expands a quote that ends with a colon or lacks a complete sentence:
 * 1. Locates quote in the full page text.
 * 2. If quote lacks terminal punctuation and does not end with a colon, extends forwards to the sentence end.
 * 3. If quote ends with a colon, extends backwards to the start of the previous sentence (antecedent).
 *    If quote starts mid-sentence, extends backwards to the start of the current sentence.
 * 4. Checks that word count is between minWords and maxWords.
 * 5. Re-runs exact substring verification against pageText.
 */
export function expandQuoteInText(
  quote: string,
  pageText: string,
  options: { minWords?: number; maxWords?: number } = {},
): { success: boolean; expanded?: string; reason?: string } {
  const minWords = options.minWords ?? parseInt(process.env.RESEARCHER_MIN_QUOTE_WORDS || '8', 10);
  const maxWords = options.maxWords ?? parseInt(process.env.RESEARCHER_MAX_QUOTE_WORDS || '60', 10);

  if (!pageText || !quote) {
    return { success: false, reason: 'Page text or quote is empty.' };
  }

  let idx = pageText.indexOf(quote);
  if (idx === -1) {
    const normPage = normalizeWhitespace(pageText);
    const normQuote = normalizeWhitespace(quote);
    if (!normPage.includes(normQuote)) {
      return { success: false, reason: 'Quote was not found in source page text.' };
    }
  }

  let start = idx;
  let end = idx + quote.length;

  if (start === -1) {
    const normQuote = normalizeWhitespace(quote);
    const words = normQuote.split(' ');
    const anchor = words.slice(0, 3).join(' ');
    start = pageText.indexOf(anchor);
    if (start === -1) {
      return { success: false, reason: 'Quote anchor not found in source page text.' };
    }
    const endAnchor = words.slice(-3).join(' ');
    const endMatch = pageText.indexOf(endAnchor, start);
    end = endMatch !== -1 ? endMatch + endAnchor.length : start + quote.length;
  }

  const trimmed = quote.trim();
  const endsWithColon = trimmed.endsWith(':');
  const hasTerminal = /[.!?]["')\]]?$/.test(trimmed);

  // 1. Extend forwards to sentence end if missing terminal punctuation and doesn't end with a colon
  if (!hasTerminal && !endsWithColon) {
    const after = pageText.substring(end);
    const m = after.match(/^[^\n\r.!?]*[.!?]["')\]]?/);
    if (m) {
      end += m[0].length;
    }
  }

  // 2. Extend backwards:
  // If ends with a colon, extend backwards to the start of the PREVIOUS sentence to capture antecedent context.
  // If starts mid-sentence (text before start in the same sentence), extend backwards to the start of this sentence.
  const before = pageText.substring(0, start);
  const boundaryRegex = /(?:[.!?]["')\]]?\s+|\n+)/g;
  const matches = [...before.matchAll(boundaryRegex)];

  let newStart = start;

  if (endsWithColon) {
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      if (lastMatch) {
        const afterLastMatch = before.substring(lastMatch.index + lastMatch[0].length);

        if (afterLastMatch.trim().length === 0) {
          // Quote started right at a sentence boundary. Step back to previous sentence.
          if (matches.length > 1) {
            const secondLastMatch = matches[matches.length - 2];
            newStart = secondLastMatch ? secondLastMatch.index + secondLastMatch[0].length : 0;
          } else {
            newStart = 0;
          }
        } else {
          newStart = lastMatch.index + lastMatch[0].length;
        }
      }
    } else {
      newStart = 0;
    }
  } else {
    // Quote started mid-sentence
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      if (lastMatch) {
        const afterLastMatch = before.substring(lastMatch.index + lastMatch[0].length);
        if (afterLastMatch.trim().length > 0) {
          newStart = lastMatch.index + lastMatch[0].length;
        }
      }
    }
  }

  const rawExpanded = pageText.substring(newStart, end).trim();
  const words = rawExpanded.split(/\s+/).filter(Boolean);

  if (words.length < minWords) {
    return {
      success: false,
      reason: `Expanded quote has only ${words.length} words (minimum required: ${minWords}).`,
      expanded: rawExpanded,
    };
  }

  if (words.length > maxWords) {
    return {
      success: false,
      reason: `Expanded quote has ${words.length} words, exceeding maximum allowed of ${maxWords}.`,
      expanded: rawExpanded,
    };
  }

  // Exact substring check
  if (
    !pageText.includes(rawExpanded) &&
    !normalizeWhitespace(pageText).includes(normalizeWhitespace(rawExpanded))
  ) {
    return {
      success: false,
      reason: 'Expanded quote is not an exact substring of source text.',
      expanded: rawExpanded,
    };
  }

  return {
    success: true,
    expanded: rawExpanded,
  };
}

/**
 * Validates note.quote quality and that note.quote is an exact substring of the fetched page text.
 * Deterministically expands quotes that end with a colon or lack a complete sentence.
 * Rejects only if expansion fails or the result is still too short or too long.
 */
export function verifyNoteQuote(
  note: Note,
  pageText: string,
  minWords: number = parseInt(process.env.RESEARCHER_MIN_QUOTE_WORDS || '8', 10),
  maxWords: number = parseInt(process.env.RESEARCHER_MAX_QUOTE_WORDS || '60', 10),
): QuoteVerificationResult {
  if (!pageText || !pageText.trim()) {
    return {
      valid: false,
      status: 'rejected',
      reason: `Page text from "${note.sourceUrl}" is empty.`,
    };
  }

  const rawQuote = note.quote ?? '';
  const trimmed = rawQuote.trim();

  // Substring check
  const isExactSubstring =
    pageText.includes(rawQuote) ||
    normalizeWhitespace(pageText).includes(normalizeWhitespace(rawQuote));
  if (!isExactSubstring) {
    return {
      valid: false,
      status: 'rejected',
      reason: `Quote "${rawQuote.slice(0, 60)}..." is not an exact substring of source page text (${note.sourceUrl}).`,
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const endsWithColon = trimmed.endsWith(':');
  const hasTerminalPunctuation = /[.!?]["')\]]?$/.test(trimmed);

  // If quote is already a complete sentence, doesn't end with a colon, and meets length: KEEP
  if (
    !endsWithColon &&
    hasTerminalPunctuation &&
    words.length >= minWords &&
    words.length <= maxWords
  ) {
    return { valid: true, status: 'kept' };
  }

  // Quote ends with colon or lacks complete sentence: EXPAND deterministically
  const expansion = expandQuoteInText(rawQuote, pageText, { minWords, maxWords });
  if (expansion.success && expansion.expanded) {
    return {
      valid: true,
      status: 'expanded',
      expandedQuote: expansion.expanded,
    };
  }

  // Reject only if expansion fails or is out of bounds
  return {
    valid: false,
    status: 'rejected',
    reason: expansion.reason ?? 'Quote expansion failed.',
  };
}

export function filterVerifiedNotes(
  proposedNotes: Note[],
  pageTextsByUrl: Map<string, string>,
  minWords?: number,
  maxWords?: number,
): {
  verifiedNotes: Note[];
  droppedCount: number;
  droppedNotes: Array<{ note: Note; reason: string }>;
  noteAudits: NoteAuditEntry[];
} {
  const verifiedNotes: Note[] = [];
  const droppedNotes: Array<{ note: Note; reason: string }> = [];
  const noteAudits: NoteAuditEntry[] = [];

  for (const rawNote of proposedNotes) {
    const pageText = pageTextsByUrl.get(rawNote.sourceUrl);
    if (!pageText) {
      droppedNotes.push({
        note: rawNote,
        reason: `Source URL "${rawNote.sourceUrl}" was not fetched during this research round.`,
      });
      noteAudits.push({
        noteId: rawNote.id,
        status: 'rejected',
        originalQuote: rawNote.quote,
        finalQuote: rawNote.quote,
        reason: `Source URL "${rawNote.sourceUrl}" was not fetched during this research round.`,
      });
      continue;
    }

    const check = verifyNoteQuote(rawNote, pageText, minWords, maxWords);
    if (check.valid) {
      const noteToKeep = { ...rawNote };
      if (check.status === 'expanded' && check.expandedQuote) {
        noteToKeep.quote = check.expandedQuote;
      }
      verifiedNotes.push(noteToKeep);
      noteAudits.push({
        noteId: rawNote.id,
        status: check.status,
        originalQuote: rawNote.quote,
        finalQuote: noteToKeep.quote,
      });
    } else {
      droppedNotes.push({
        note: rawNote,
        reason: check.reason ?? 'Quote mismatch',
      });
      noteAudits.push({
        noteId: rawNote.id,
        status: 'rejected',
        originalQuote: rawNote.quote,
        finalQuote: rawNote.quote,
        reason: check.reason ?? 'Quote mismatch',
      });
    }
  }

  return {
    verifiedNotes,
    droppedCount: droppedNotes.length,
    droppedNotes,
    noteAudits,
  };
}
