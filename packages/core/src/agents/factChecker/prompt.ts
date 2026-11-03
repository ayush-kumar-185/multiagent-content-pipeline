import { Claim } from '../../schemas/claim.js';
import { Note } from '../../schemas/note.js';

export function buildFactCheckerSystemPrompt(): string {
  return `You are CiteWriter's Fact-Checker Agent.
Your job is to verify each claim made in an article strictly against the cited notes and their primary source quotes.

CRITICAL VERIFICATION RULES:
1. "Supported" means THE SOURCE SAYS IT, NOT that it is true in the world.
2. Check numbers, names, dates, and qualifiers ("all", "always", "up to", "first", "only", "every") exactly:
   - If the source quote says "can support up to 50%" but the claim states "supports 50%", mark as "unsupported" due to an overstated qualifier.
   - If a date, name, or metric does not align with the quote, mark as "unsupported".
   - If the quote states the fact as written, mark as "supported".
   - If the cited quote is ambiguous or lacks necessary context to judge the claim, mark as "needs_more_research".
3. Return valid JSON containing a list of checked claims:
{
  "checks": [
    {
      "claim": "The exact claim text being evaluated",
      "noteIds": ["n1"],
      "status": "supported" | "unsupported" | "needs_more_research",
      "reason": "Detailed explanation of why this claim is supported, unsupported, or needs more research."
    }
  ]
}`;
}

export function buildFactCheckerUserPrompt(
  claims: Claim[],
  notes: Note[],
  additionalSourceContext?: Map<string, string>,
): string {
  const notesMap = new Map<string, Note>();
  for (const n of notes) {
    notesMap.set(n.id, n);
  }

  const claimsFormatted = claims
    .map((c, i) => {
      const citedNotesInfo = c.noteIds
        .map((id) => {
          const note = notesMap.get(id);
          if (!note) return `  - [${id}]: Not found`;
          const extraContext = additionalSourceContext?.get(note.sourceUrl);
          const contextSnippet = extraContext
            ? `\n    Additional Source Context (from ${note.sourceUrl}):\n    "${extraContext.slice(0, 300)}..."`
            : '';
          return `  - [${note.id}] Source: ${note.sourceUrl}\n    Quote: "${note.quote}"${contextSnippet}`;
        })
        .join('\n');

      return `### Claim ${i + 1}:\n"${c.claim}"\nCited Notes:\n${citedNotesInfo}`;
    })
    .join('\n\n');

  return `Please verify the following claims against their cited note quotes:

${claimsFormatted}

Evaluate every claim rigorously. Return the result in the JSON format with "checks".`;
}
