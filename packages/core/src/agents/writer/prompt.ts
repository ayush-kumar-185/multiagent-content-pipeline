import { Note } from '../../schemas/note.js';
import { RunConfig } from '../../schemas/config.js';
import { ClaimCheck } from '../../schemas/claim.js';
import { EditorVerdict } from '../../schemas/editor.js';
import { ContentPlan } from '../../schemas/contentPlan.js';

export function buildWriterSystemPrompt(config: RunConfig): string {
  const format = config.format ?? 'article';

  let formatInstructions = '';
  if (format === 'linkedin_post') {
    formatInstructions = `
FORMAT SPECIFICATION: LINKEDIN POST (~150-300 words)
- Write an engaging, high-impact professional LinkedIn post.
- Opening: A captivating, bold hook sentence that immediately stops the scroll and answers the core angle.
- Body: High-value technical takeaways broken down into short, readable paragraphs and bullet points. Never repeat stats.
- Citations: EVERY factual sentence or claim MUST end with its source note identifier, e.g. [n1] or [n1, n2].
- Closing: A thoughtful takeaway or question for the engineering community, followed by 3-5 relevant hashtags.`;
  } else if (format === 'twitter_thread') {
    formatInstructions = `
FORMAT SPECIFICATION: X / TWITTER THREAD (~5-8 tweets)
- Write a numbered Twitter/X thread (format each tweet starting with "1/", "2/", "3/", etc.).
- Tweet 1: A punchy hook tweet that immediately introduces the core revelation/answer.
- Body Tweets (2 to N-1): Each tweet must be a standalone, progressive insight under 280 characters.
- REPETITION CONTROL: Never repeat the same statistic or percentage across multiple tweets. If 30% is stated in Tweet 1 or 2, DO NOT repeat 30% in later tweets; explain the mechanism, consequences, or solutions instead.
- Citations: EVERY factual sentence or claim in every tweet MUST carry its source note identifier, e.g. [n1].
- Final Tweet: A concise wrap-up summarizing the key lessons and takeaways.
- Separate each tweet with two blank lines.`;
  } else {
    formatInstructions = `
FORMAT SPECIFICATION: TECHNICAL ARTICLE (~${config.targetWords} words)
- Write a structured, authoritative technical article in Markdown.
- Use clear Markdown headings (H1, H2, H3) and structured paragraphs.
- Title and Topic Fidelity: The article title (H1) and body MUST directly address the requested topic.
- Depth and Progression: Each section must develop a new aspect of the topic (e.g. Mechanism -> Environmental Context -> Solutions -> Conclusion) without looping back or repeating previously stated facts.
- Every body sentence MUST be directly stated in its cited note and MUST end with a valid citation marker (e.g. [n1] or [n1, n2]).
- Strictly NO uncited body sentences: if a note does not support a sentence, omit the sentence entirely.
- Choose section headings (H2, H3) that accurately describe the specific notes assigned to them.`;
  }

  return `You are CiteWriter's Writer Agent.
Your job is to produce a publication-ready piece of content based STRICTLY and ONLY on the facts contained in the provided notes.

CONTENT FORMAT: ${format.toUpperCase().replace('_', ' ')}
${formatInstructions}

CORE CITATION & FACTUAL GROUNDING RULES:
1. You may state ONLY facts directly stated in the provided notes. Every factual sentence MUST be directly stated in its cited note.
2. NO UNCITED SENTENCES: Absolutely every body sentence (excluding markdown headings) MUST end with at least one citation marker [n...] referring to a valid note ID. If a note does not support a sentence, OMIT the sentence entirely. Do not write ungrounded introductory, concluding, or transitional filler sentences.
3. PRESERVE EXPERIMENTAL CONTEXT & QUALIFICATIONS:
   - When citing precise metrics (e.g. 30%, 85 dB), communicate the study context (e.g. "In simulated 8,000-ft cabin pressure tests", "acoustic engine noise at 85 dB").
   - Retain specific modalities: if a study measured sweet and salty taste thresholds, do not overgeneralize to "all senses" or "all flavors".
   - Distinguish measured results from explanatory hypotheses; avoid converting hypotheses into definitive physiological dogmas.
4. COHERENT NARRATIVE TRANSITIONS & DISTINCT INSIGHTS:
   - Ensure each tweet or section provides a distinct insight. Clearly distinguish separate environmental mechanisms (humidity affecting olfaction vs pressure affecting taste thresholds vs engine acoustics modulating pathways).
   - Make transitions explain why the next point follows from the previous one.
   - Do NOT introduce airline business practices or menu motives unless those practices are independently documented in the notes.
5. NOTE COVERAGE & PRIORITIZATION: Cover every distinct note at least once where the note is relevant to the topic. Prioritize notes that match the topic's key terms. Quality over note-cramming: select the best notes that serve the content plan rather than forcing irrelevant notes. When new notes are added after re-research, actively use them in the next draft instead of only fixing flagged claims.
6. DO NOT LOOSEN CITATION RULES: Never loosen or bypass citation rules for flow or length.
7. REPETITION ERADICATION: Never repeat the same statistic, figure, percentage, or core finding in multiple sections or tweets. State it once with maximum impact, and use subsequent sections to explore mechanisms and implications.
8. FOLLOW CONTENT PLAN: If a ContentPlan is provided, follow its centralAngle, narrativeFlow, and heed its redundantInformation and avoid guidance.
9. ACCURATE HEADINGS: Choose section headings that accurately describe the notes assigned to them. Every note grouped under a heading must match the topic of that heading.
10. Strictly FORBID explanatory, motivational, or benefit sentences (e.g. "enhances developer velocity", "reduces bundle sizes", "improves maintainability") and any numbers or metrics not present in the notes.
11. Do NOT extrapolate, hallucinate, speculate, or invent unverified facts, benefits, or implications.
12. Target Audience: ${config.audience}
13. Target Tone: ${config.tone}

You must return a JSON object with:
{
  "draft": "Full content text with inline [n...] citations..."
}`;
}

export function buildWriterInitialPrompt(
  topic: string,
  notes: Note[],
  contentPlan?: ContentPlan,
): string {
  const notesFormatted = notes
    .map((n) => `[${n.id}] Claim: ${n.claim}\nSource: ${n.sourceUrl}\nQuote: "${n.quote}"`)
    .join('\n\n');

  let planContext = '';
  if (contentPlan) {
    planContext = `
Content Blueprint (FOLLOW THIS STRUCTURE):
- Central Angle: ${contentPlan.centralAngle}
- Intended Takeaway: ${contentPlan.intendedTakeaway}
- Narrative Flow:
${contentPlan.narrativeFlow
  .map(
    (s) =>
      `  * [${s.id}] ${s.heading}: ${s.keyPoint} (Assigned Notes: ${s.assignedNoteIds.join(', ') || 'none'})`,
  )
  .join('\n')}
- Redundant Info to Avoid Repeating:
${contentPlan.redundantInformation.map((r) => `  * ${r}`).join('\n') || '  (None)'}
- Avoid:
${contentPlan.avoid.map((a) => `  * ${a}`).join('\n') || '  (None)'}
`;
  }

  return `Topic: "${topic}"

Available Notes:
${notesFormatted}
${planContext}
Write the content now. Follow these mandatory rules:
1. Cover every distinct note at least once where the note is relevant to the topic; prioritize notes that match the topic's key terms.
2. Follow the Content Blueprint above. Never repeat the same statistic or percentage across multiple sections/tweets.
3. Every body sentence MUST end with a citation marker [n...] matching the notes above. Absolutely no uncited body sentences.
4. Do not loosen the citation rule: if a note does not directly support a sentence, omit the sentence entirely.
5. Quality over note-cramming: use the notes assigned to each section, without cramming duplicate or irrelevant notes.
6. The title and body MUST directly address "${topic}".`;
}

export function buildWriterRevisionPrompt(
  topic: string,
  notes: Note[],
  previousDraft: string,
  unsupportedClaims: ClaimCheck[],
  editorVerdict?: EditorVerdict,
  contentPlan?: ContentPlan,
): string {
  const notesFormatted = notes
    .map((n) => `[${n.id}] Claim: ${n.claim}\nSource: ${n.sourceUrl}\nQuote: "${n.quote}"`)
    .join('\n\n');

  const issuesFormatted = unsupportedClaims
    .map((c) => `- Claim: "${c.claim}" (Status: ${c.status})\n  Issue: ${c.reason}`)
    .join('\n');

  let editorFeedback = 'No editor feedback.';
  if (editorVerdict) {
    const revisionInstructionsFormatted = editorVerdict.revisionInstructions?.length
      ? `\nActionable Revision Instructions:\n${editorVerdict.revisionInstructions
          .map((inst) => `- Section: ${inst.section} | Issue: ${inst.issue} | Action: ${inst.action}`)
          .join('\n')}`
      : '';

    const repetitionWarnings = editorVerdict.repetitionFindings?.length
      ? `\nRepetition Flags to Fix:\n${editorVerdict.repetitionFindings
          .map((r) => `- ${r.repeatedIdea} (Severity: ${r.severity}, Recommendation: ${r.recommendation})`)
          .join('\n')}`
      : '';

    editorFeedback = `Editor Feedback (Score ${editorVerdict.score}/10): ${editorVerdict.feedback}${revisionInstructionsFormatted}${repetitionWarnings}`;
  }

  let planContext = '';
  if (contentPlan) {
    planContext = `\nContent Blueprint:\n- Central Angle: ${contentPlan.centralAngle}\n- Intended Takeaway: ${contentPlan.intendedTakeaway}\n`;
  }

  return `Topic: "${topic}"

Available Notes (including any new notes added after research):
${notesFormatted}
${planContext}
Previous Draft:
${previousDraft}

Issues to fix in this revision:
${issuesFormatted || 'None.'}

${editorFeedback}

Instructions for Revision:
- Cover every distinct note at least once where the note is relevant to the topic; prioritize notes that match the topic's key terms.
- When new notes are added after re-research, actively use and incorporate them into the next draft instead of only fixing flagged claims.
- Strictly fix each issue identified in the Actionable Revision Instructions and Repetition Flags above.
- Never repeat the same statistic or percentage across multiple sections or tweets.
- Do not loosen the citation rule: every body sentence MUST be directly stated in its cited note and end with at least one valid citation marker [n...].
- Fix or REMOVE any unsupported, contradicted, or unverified claims.
- NO UNCITED SENTENCES: Ensure every single body sentence ends with at least one valid citation marker [n...].
- Ensure section headings accurately describe the notes placed under them.
- Ensure the title and body directly address "${topic}" without title drift.
- Address the editor's feedback without adding ungrounded explanations or extrapolations.
- Retain all citations for verified facts [n...].
- Output the complete revised text in the JSON "draft" field.`;
}
