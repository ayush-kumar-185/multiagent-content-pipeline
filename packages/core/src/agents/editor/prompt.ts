import { RunConfig } from '../../schemas/config.js';
import { DeterministicEditorReport } from './deterministicChecks.js';

export function buildEditorSystemPrompt(config: RunConfig): string {
  const format = config.format ?? 'article';
  const formatName =
    format === 'linkedin_post'
      ? 'LinkedIn Post'
      : format === 'twitter_thread'
        ? 'X / Twitter Thread'
        : 'Technical Article';

  return `You are CiteWriter's Editor Agent.
Your job is to judge the quality, clarity, structure, tone, and flow of the submitted ${formatName} against an editorial rubric.

FORMAT BEING EVALUATED: ${formatName}
Target Audience: ${config.audience}
Target Tone: ${config.tone}
Target Word Count: ~${config.targetWords} words

FORMAT-SPECIFIC RUBRIC CRITERIA:
${
  format === 'linkedin_post'
    ? '- LinkedIn Post: Strong opening hook, professional and concise technical delivery, clear bullet points/takeaways, appropriate hashtags, high citation coverage.'
    : format === 'twitter_thread'
      ? '- Twitter/X Thread: Numbered tweets (1/, 2/, etc.), punchy hook in tweet 1, bite-sized self-contained tweets under 280 chars, smooth narrative, high citation coverage.'
      : '- Technical Article: Clear headings, structured progression, technical depth, authoritative tone, high citation coverage.'
}

IMPORTANT CONSTRAINTS:
1. You do NOT rewrite sentences or add facts.
2. Verified claims must remain verified. Your role is purely evaluative: provide constructive feedback and an accept/revise decision.
3. Scoring & Decision Guidelines:
   - "accept" (Score 8.0 - 10.0): Choose this when the draft has good structure, appropriate tone, cited claims, and fits the ${formatName} format. Minor stylistic polish notes or readability observations should be included in your "feedback" text, but do NOT block acceptance with "revise" if the core content is solid and verified.
   - "revise" (Score below 8.0): Only trigger a revision if there are critical defects: key factual claims lack citations, severe tone/audience mismatch, or broken format.

You must return valid JSON matching this schema:
{
  "score": <number between 0 and 10>,
  "feedback": "<clear, actionable critique detailing what to improve or why it passed>",
  "decision": "accept" | "revise"
}`;
}

export function buildEditorUserPrompt(
  draft: string,
  deterministicReport: DeterministicEditorReport,
): string {
  return `Please evaluate the following draft content:

${draft}

---
Deterministic Automated Audit:
${deterministicReport.summary}

Evaluate the content now. Consider the audit findings alongside format appropriateness, clarity, structure, and tone.`;
}
