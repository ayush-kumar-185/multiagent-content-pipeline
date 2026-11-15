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
- Final Tweet: A concise wrap-up summarizing the key lessons and encouraging readers to bookmark or share. Do NOT attach citation brackets to non-factual closing calls to action.
- Separate each tweet with two blank lines.`;
  } else {
    formatInstructions = `
FORMAT SPECIFICATION: TECHNICAL ARTICLE (~${config.targetWords} words)
- Write a structured, authoritative technical article in Markdown.
- Use clear Markdown headings (H1, H2, H3) and structured paragraphs.
- Every body sentence MUST be directly stated in its cited note and MUST end with a valid citation marker (e.g. [n1] or [n1, n2]).
- Strictly NO uncited body sentences: if a note does not support a sentence, omit the sentence entirely.
- Strictly FORBID explanatory, motivational, benefit, or transition sentences (e.g. claims that a feature "reduces bundle size", "enhances type safety", or "improves developer velocity") unless that exact statement is explicitly present in the cited note.
- Strictly FORBID any numbers, statistics, percentages, or dates not present in the cited notes.
- Choose section headings (H2, H3) that accurately describe the specific notes assigned to them. Never place notes under misleading, mismatched, or unrelated headings (e.g., do not place deprecated flags notes under a "Re-exports" heading; name the heading "Compiler Flags and Warnings" or similar).`;
  }

  return `You are CiteWriter's Writer Agent.
Your job is to produce a publication-ready piece of technical content based STRICTLY and ONLY on the facts contained in the provided notes.

CONTENT FORMAT: ${format.toUpperCase().replace('_', ' ')}
${formatInstructions}

CORE CITATION & FACTUAL GROUNDING RULES:
1. You may state ONLY facts directly stated in the provided notes. Every factual sentence MUST be directly stated in its cited note.
2. NO UNCITED SENTENCES: Absolutely every body sentence (excluding markdown headings) MUST end with at least one citation marker [n...] referring to a valid note ID. If a note does not support a sentence, OMIT the sentence entirely. Do not write ungrounded introductory, concluding, or transitional filler sentences.
3. ACCURATE HEADINGS: Choose section headings that accurately describe the notes assigned to them. Every note grouped under a heading must match the topic of that heading.
4. Strictly FORBID explanatory, motivational, or benefit sentences (e.g. "enhances developer velocity", "reduces bundle sizes", "improves maintainability") and any numbers or metrics not present in the notes.
5. Do NOT extrapolate, hallucinate, speculate, or invent unverified facts, benefits, or implications.
6. Target Audience: ${config.audience}
7. Target Tone: ${config.tone}

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

Write the content now. Follow these mandatory rules:
1. Every body sentence MUST end with a citation marker [n...] matching the notes above. Absolutely no uncited body sentences.
2. If a note does not directly support a sentence, omit the sentence entirely. Do not add ungrounded benefits, explanations, or numbers not present in the notes.
3. Choose section headings that accurately describe the notes assigned to them (e.g. do not label deprecated flags as "Re-exports").`;
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
- Fix or REMOVE any unsupported or unverified claims. If a note does not support a sentence, OMIT the sentence.
- NO UNCITED SENTENCES: Ensure every single body sentence ends with at least one valid citation marker [n...].
- Ensure section headings accurately describe the notes placed under them.
- Address the editor's feedback without adding ungrounded explanations or extrapolations.
- Retain all citations for verified facts [n...].
- Output the complete revised text in the JSON "draft" field.`;
}
