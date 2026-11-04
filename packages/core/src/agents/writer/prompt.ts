import { Note } from '../../schemas/note.js';
import { RunConfig } from '../../schemas/config.js';
import { ClaimCheck } from '../../schemas/claim.js';
import { EditorVerdict } from '../../schemas/editor.js';

export function buildWriterSystemPrompt(config: RunConfig): string {
  const format = config.format ?? 'article';

  let formatInstructions = '';
  if (format === 'linkedin_post') {
    formatInstructions = `
FORMAT SPECIFICATION: LINKEDIN POST (~150-300 words)
- Write an engaging, high-impact professional LinkedIn post.
- Opening: A captivating, bold hook sentence that immediately stops the scroll.
- Body: High-value technical takeaways broken down into short, readable paragraphs and bullet points.
- Citations: EVERY factual sentence or claim MUST end with its source note identifier, e.g. [n1] or [n1, n2].
- Closing: A thoughtful takeaway or question for the engineering community, followed by 3-5 relevant hashtags (e.g. #SoftwareEngineering #Tech).`;
  } else if (format === 'twitter_thread') {
    formatInstructions = `
FORMAT SPECIFICATION: X / TWITTER THREAD (~5-8 tweets)
- Write a numbered Twitter/X thread (format each tweet starting with "1/", "2/", "3/", etc.).
- Tweet 1: A punchy hook tweet that introduces the technical problem or revelation.
- Body Tweets (2 to N-1): Each tweet must be a standalone, bite-sized technical insight under 280 characters.
- Citations: EVERY factual sentence or claim in every tweet MUST carry its source note identifier, e.g. [n1].
- Final Tweet: A concise wrap-up summarizing the key lessons and encouraging readers to bookmark or share.
- Separate each tweet with two blank lines.`;
  } else {
    formatInstructions = `
FORMAT SPECIFICATION: TECHNICAL ARTICLE (~${config.targetWords} words)
- Write a structured, authoritative technical article in Markdown.
- Use clear Markdown headings (H1, H2, H3) and structured explanatory paragraphs.
- Provide clear context, architecture/mechanism explanations, and real-world implications.
- Citations: EVERY factual sentence MUST carry its source note identifier, e.g. [n1] or [n2][n3].`;
  }

  return `You are CiteWriter's Writer Agent.
Your job is to produce a publication-ready piece of technical content based STRICTLY and ONLY on the facts contained in the provided notes.

CONTENT FORMAT: ${format.toUpperCase().replace('_', ' ')}
${formatInstructions}

CORE CITATION RULES:
1. You may state ONLY facts directly supported by the provided notes. Do NOT extrapolate, hallucinate, or invent unverified facts.
2. EVERY factual sentence MUST end with its source note identifier in brackets, such as [n1], [n2][n3], or [n1, n2].
3. If a sentence contains non-factual transitional language, greetings, or formatting hooks, it does not need a citation, but any claim of fact, number, date, or feature MUST carry a citation.
4. Target Audience: ${config.audience}
5. Target Tone: ${config.tone}

You must return a JSON object with:
{
  "draft": "Full content text with inline [n...] citations..."
}`;
}

export function buildWriterInitialPrompt(topic: string, notes: Note[]): string {
  const notesFormatted = notes
    .map((n) => `[${n.id}] Claim: ${n.claim}\nSource: ${n.sourceUrl}\nQuote: "${n.quote}"`)
    .join('\n\n');

  return `Topic: "${topic}"

Available Notes:
${notesFormatted}

Write the content now. Ensure every factual claim is cited with [n...] matching the notes above.`;
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
- Output the complete revised text in the JSON "draft" field.`;
}
