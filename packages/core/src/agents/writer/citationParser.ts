import { Claim } from '../../schemas/claim.js';

/**
 * Parses a markdown article draft into an array of Claim objects.
 * Matches citation markers like [n1], [n1][n2], [n1, n2], or [n3,n4].
 */
export function parseCitationsFromDraft(draft: string): Claim[] {
  const claims: Claim[] = [];
  if (!draft || !draft.trim()) {
    return claims;
  }

  // Split into paragraphs / lines
  const lines = draft.split(/\r?\n/);
  let claimIndex = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip markdown headers, dividers, or empty lines
    if (!line || line.startsWith('#') || line.startsWith('---') || line.startsWith('===')) {
      continue;
    }

    // Split line into sentences. Punctuation followed by space or end of string.
    // Handles '. ', '! ', '? '
    const sentenceCandidates = line
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const candidate of sentenceCandidates) {
      // Find all citation patterns like [n1], [n2], [n1, n2]
      const citationRegex = /\[((?:n\d+(?:\s*,\s*n\d+)*)|(?:n\d+))\]/g;
      const matches = Array.from(candidate.matchAll(citationRegex));

      if (matches.length > 0) {
        const noteIdsSet = new Set<string>();

        for (const match of matches) {
          const inner = match[1];
          if (inner) {
            // Can be single 'n1' or comma-separated 'n1, n2'
            const ids = inner.split(',').map((id) => id.trim());
            for (const id of ids) {
              if (/^n\d+$/.test(id)) {
                noteIdsSet.add(id);
              }
            }
          }
        }

        if (noteIdsSet.size > 0) {
          // Remove the citation markers from the claim text for clean factual statement
          const cleanClaim = candidate
            .replace(/\[(?:n\d+(?:\s*,\s*n\d+)*)\]/g, '')
            .replace(/\s+([.,!?;:])/g, '$1')
            .replace(/\s{2,}/g, ' ')
            .trim();

          claims.push({
            id: `c${claimIndex++}`,
            claim: cleanClaim,
            noteIds: Array.from(noteIdsSet),
          });
        }
      }
    }
  }

  return claims;
}
