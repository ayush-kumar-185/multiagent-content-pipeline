import { Note } from '../../schemas/note.js';

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Validates that note.quote is an exact substring of the fetched page text.
 * Drops notes that fail verification.
 */
export function verifyNoteQuote(note: Note, pageText: string): { valid: boolean; reason?: string } {
  if (!pageText || !pageText.trim()) {
    return { valid: false, reason: `Page text from "${note.sourceUrl}" is empty.` };
  }

  // 1. Direct exact substring check
  if (pageText.includes(note.quote)) {
    return { valid: true };
  }

  // 2. Normalized whitespace check (handles minor newline vs space differences)
  const normPage = normalizeWhitespace(pageText);
  const normQuote = normalizeWhitespace(note.quote);

  if (normPage.includes(normQuote)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Quote "${note.quote.slice(0, 60)}..." is not an exact substring of source page text (${note.sourceUrl}).`,
  };
}

export function filterVerifiedNotes(
  proposedNotes: Note[],
  pageTextsByUrl: Map<string, string>,
): {
  verifiedNotes: Note[];
  droppedCount: number;
  droppedNotes: Array<{ note: Note; reason: string }>;
} {
  const verifiedNotes: Note[] = [];
  const droppedNotes: Array<{ note: Note; reason: string }> = [];

  for (const note of proposedNotes) {
    const pageText = pageTextsByUrl.get(note.sourceUrl);
    if (!pageText) {
      droppedNotes.push({
        note,
        reason: `Source URL "${note.sourceUrl}" was not fetched during this research round.`,
      });
      continue;
    }

    const check = verifyNoteQuote(note, pageText);
    if (check.valid) {
      verifiedNotes.push(note);
    } else {
      droppedNotes.push({
        note,
        reason: check.reason ?? 'Quote mismatch',
      });
    }
  }

  return {
    verifiedNotes,
    droppedCount: droppedNotes.length,
    droppedNotes,
  };
}
