import { RunConfig } from '../../schemas/config.js';
import { DeterministicEditorReport } from './deterministicChecks.js';

export function buildEditorSystemPrompt(config: RunConfig): string {
  return `You are CiteWriter's Editor Agent.
Your job is to judge the quality, clarity, structure, tone, length, and flow of the submitted technical article against an editorial rubric.

IMPORTANT CONSTRAINTS:
1. You do NOT rewrite sentences or add facts.
2. Verified claims must remain verified. Your role is purely evaluative: provide constructive feedback and an accept/revise decision.
3. Scoring Rubric (0 to 10):
   - 8.0 - 10.0: High quality, clear structure, appropriate tone, acceptable length, high citation coverage. Decision: "accept".
   - Below 8.0: Needs revision (pacing, tone, excessive fluff, missing structure, or severe length deviation). Decision: "revise".

Target Audience: ${config.audience}
Target Tone: ${config.tone}
Target Word Count: ${config.targetWords} words

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
  return `Please evaluate the following draft article:

${draft}

---
Deterministic Automated Audit:
${deterministicReport.summary}

Evaluate the article now. Consider the audit findings alongside clarity, structure, and tone.`;
}
