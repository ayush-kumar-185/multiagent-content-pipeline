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
Target Word Count: ~${config.targetWords} words (Advisory if all claims are supported)

EVALUATION RUBRIC ACROSS 9 WEIGHTED DIMENSIONS (Score each 0.0 to 10.0):
1. Factual Reliability (20%): Strict adherence to cited sources. Every factual claim grounded. Hard gate: must be >= 7.0.
2. Relevance & Focus (15%): Direct, comprehensive answer to the user's specific prompt without topic drift.
3. Depth & Explanatory Power (15%): Explains underlying mechanisms clearly rather than superficial mentions.
4. Logical Flow & Narrative Progression (10%): Ideas build progressively; each section connects naturally to the next.
5. Originality & Framing (10%): Fresh perspective and engaging angle without adding uncited facts.
6. Engagement & Tone Match (10%): Fits target tone (${config.tone}) and audience (${config.audience}).
7. Repetition Control (10%): No repeating the same statistic across multiple tweets/paragraphs. No redundant idea overlap.
8. Readability & Polish (5%): Fluent sentence cadence, clean formatting, zero boilerplate fluff.
9. Conclusion Quality (5%): Satisfying synthesis or practical takeaway, not a generic repetitive sign-off.

FORMAT-SPECIFIC CRITERIA:
${
  format === 'linkedin_post'
    ? '- LinkedIn Post: Strong opening hook, professional and concise technical delivery, clear bullet points/takeaways, appropriate hashtags, high citation coverage.'
    : format === 'twitter_thread'
      ? '- Twitter/X Thread: Numbered tweets (1/, 2/, etc.), punchy hook in tweet 1, bite-sized self-contained tweets under 280 chars, smooth narrative progression across tweets, no repeating the same stat in multiple tweets.'
      : '- Technical Article: Clear headings matching content, structured progression, technical precision, high citation coverage.'
}

HARD QUALITY GATES:
- If factual reliability < 7.0 or any claim is contradicted -> MUST REVISE.
- If severe repetition exists (same stat in 2+ sections or high idea overlap) -> MUST REVISE.
- If main topic is missing or title drifted -> MUST REVISE.

REVISION INSTRUCTIONS:
If the draft requires revision (score < 7.5 or failed quality gate), you MUST provide actionable revision instructions specifying the exact section, issue, and action.

You must return valid JSON matching this schema:
{
  "score": <number between 0 and 10>,
  "overallScore": <number between 0 and 10>,
  "scores": {
    "factualReliability": <0-10>,
    "relevance": <0-10>,
    "depth": <0-10>,
    "logicalFlow": <0-10>,
    "originality": <0-10>,
    "engagement": <0-10>,
    "repetitionControl": <0-10>,
    "readability": <0-10>,
    "conclusionQuality": <0-10>
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>"],
  "redundantSections": ["<e.g. Tweet 3 repeats statistic from Tweet 2>"],
  "revisionInstructions": [
    {
      "section": "<e.g. Tweet 3 or Section: Cabin Pressure>",
      "issue": "<what is wrong, e.g. repeats the 30% stat>",
      "action": "<exact instruction, e.g. Replace repeated 30% stat with olfactory mechanism>"
    }
  ],
  "feedback": "<clear, comprehensive critique detailing why it passed or what must be fixed>",
  "decision": "accept" | "revise"
}`;
}

export function buildEditorUserPrompt(
  draft: string,
  deterministicReport: DeterministicEditorReport,
  topic?: string,
): string {
  const topicContext = topic ? `Requested Topic: "${topic}"\n\n` : '';
  const repetitionAlert =
    deterministicReport.repetitionFindings &&
    deterministicReport.repetitionFindings.length > 0
      ? `\n\nAutomated Repetition Flags:\n${deterministicReport.repetitionFindings
          .map((f) => `- [${f.severity.toUpperCase()}] ${f.repeatedIdea} (Recommendation: ${f.recommendation})`)
          .join('\n')}`
      : '';

  return `${topicContext}Please evaluate the following draft content:

${draft}

---
Deterministic Automated Audit:
${deterministicReport.summary}${repetitionAlert}

Evaluate the content now against the 9 quality dimensions. Check that the draft directly answers the prompt, ensure no repeated statistics, and enforce all hard quality gates.`;
}
