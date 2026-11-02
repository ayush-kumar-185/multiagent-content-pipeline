import { Note } from '../../schemas/note.js';
import { RunConfig } from '../../schemas/config.js';
import { ClaimCheck } from '../../schemas/claim.js';
import { EditorVerdict } from '../../schemas/editor.js';

export function buildWriterSystemPrompt(config: RunConfig): string {
  return `You are CiteWriter's Writer Agent.
Your job is to write a rigorous, authoritative technical article in Markdown based STRICTLY and ONLY on the facts contained in the provided notes.

CORE CITATION RULES:
1. You may state ONLY facts directly supported by the provided notes. Do NOT extrapolate, hallucinate, or add external facts.
2. EVERY factual sentence MUST end with its source note identifier in brackets, such as [n1], [n2][n3], or [n1, n2].
3. If a sentence contains non-factual transitional language (e.g., introductory remarks), it does not need a citation, but any claim of fact, number, date, or feature MUST carry a citation.
4. Keep the target audience (${config.audience}), tone (${config.tone}), and target word count (~${config.targetWords} words) in mind.
5. Use clear Markdown headings and structured paragraphs.

You must return a JSON object with:
{
  "draft": "Full markdown text of the article..."
}`;
}

export function buildWriterInitialPrompt(topic: string, notes: Note[]): string {
  const notesFormatted = notes
    .map((n) => `[${n.id}] Claim: ${n.claim}\nSource: ${n.sourceUrl}\nQuote: "${n.quote}"`)
    .join('\n\n');

  return `Topic: "${topic}"

Available Notes:
${notesFormatted}

Write the technical article now. Ensure every factual claim is cited with [n...] matching the notes above.`;
}

export function buildWriterRevisionPrompt(
  previousDraft: string,
  unsupportedClaims: ClaimCheck[],
  editorVerdict?: EditorVerdict,
): string {
  const issuesFormatted = unsupportedClaims
    .map((c) => `- Claim: "${c.claim}" (Status: ${c.status})\n  Issue: ${c.reason}`)
    .join('\n');

  const editorFeedback = editorVerdict
    ? `Editor Feedback (Score ${editorVerdict.score}/10): ${editorVerdict.feedback}`
    : 'No editor feedback.';

  return `Previous Draft:
${previousDraft}

Issues to fix in this revision:
${issuesFormatted || 'None.'}

${editorFeedback}

Instructions for Revision:
- Fix or remove any unsupported or unverified claims.
- Address the editor's stylistic and structural feedback.
- Retain all citations for verified facts [n...].
- Output the complete revised Markdown article in the JSON "draft" field.`;
}
