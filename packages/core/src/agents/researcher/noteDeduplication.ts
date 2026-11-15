import { Note } from '../../schemas/note.js';

export function normalizeQuote(quote: string): string {
  return (quote || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeUrl(url: string): string {
  return (url || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

export function areQuotesDuplicate(
  existingNote: { quote: string; sourceUrl: string },
  candidateNote: { quote: string; sourceUrl: string },
): { isDuplicate: boolean; reason?: string } {
  const normExisting = normalizeQuote(existingNote.quote);
  const normCandidate = normalizeQuote(candidateNote.quote);

  if (!normExisting || !normCandidate) {
    return { isDuplicate: false };
  }

  // 1. Exact normalized quote match (lowercased, whitespace collapsed)
  if (normExisting === normCandidate) {
    return { isDuplicate: true, reason: 'Exact normalized quote match' };
  }

  // 2. Heavy overlap on matching source URL
  const urlExisting = normalizeUrl(existingNote.sourceUrl);
  const urlCandidate = normalizeUrl(candidateNote.sourceUrl);

  if (urlExisting === urlCandidate && urlExisting.length > 0) {
    // Check substring containment (one quote is contained in the other)
    if (normExisting.includes(normCandidate) || normCandidate.includes(normExisting)) {
      return {
        isDuplicate: true,
        reason: 'Quote substring containment on matching source URL',
      };
    }

    // Check heavy token overlap
    const wordsExisting = new Set(normExisting.split(' ').filter(Boolean));
    const wordsCandidate = new Set(normCandidate.split(' ').filter(Boolean));

    if (wordsExisting.size > 0 && wordsCandidate.size > 0) {
      let commonCount = 0;
      for (const w of wordsCandidate) {
        if (wordsExisting.has(w)) commonCount++;
      }
      const minWords = Math.min(wordsExisting.size, wordsCandidate.size);
      const overlapRatio = commonCount / minWords;

      if (overlapRatio >= 0.75) {
        return {
          isDuplicate: true,
          reason: `Heavy word overlap (${(overlapRatio * 100).toFixed(0)}%) on matching source URL`,
        };
      }
    }
  }

  return { isDuplicate: false };
}

export interface DeduplicateNotesResult {
  mergedNotes: Note[];
  droppedNotes: Array<{
    note: Omit<Note, 'id'> | Note;
    reason: string;
    matchedNoteId: string;
  }>;
}

export function deduplicateNotes(
  existingNotes: Note[],
  incomingNotes: Array<Omit<Note, 'id'> | Note>,
): DeduplicateNotesResult {
  const mergedNotes: Note[] = [...existingNotes];
  const droppedNotes: Array<{
    note: Omit<Note, 'id'> | Note;
    reason: string;
    matchedNoteId: string;
  }> = [];

  // Determine the next numeric note index based on existing n<k> IDs
  let maxIdNum = 0;
  for (const n of existingNotes) {
    const match = n.id.match(/^n(\d+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > maxIdNum) maxIdNum = num;
    }
  }

  for (const inc of incomingNotes) {
    let duplicateMatch: { matchedNote: Note; reason: string } | null = null;

    for (const existing of mergedNotes) {
      const check = areQuotesDuplicate(existing, inc);
      if (check.isDuplicate) {
        duplicateMatch = { matchedNote: existing, reason: check.reason! };
        break;
      }
    }

    if (duplicateMatch) {
      droppedNotes.push({
        note: inc,
        reason: duplicateMatch.reason,
        matchedNoteId: duplicateMatch.matchedNote.id,
      });
      // The incoming note is dropped; the existing note's id is preserved.
    } else {
      maxIdNum++;
      mergedNotes.push({
        ...inc,
        id: `n${maxIdNum}`,
      });
    }
  }

  return { mergedNotes, droppedNotes };
}
