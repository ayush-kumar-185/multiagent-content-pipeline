import { RunConfig } from '../../schemas/config.js';
import { Note } from '../../schemas/note.js';

export function buildPlannerSystemPrompt(config: RunConfig): string {
  const format = config.format ?? 'article';
  const formatName =
    format === 'linkedin_post'
      ? 'LinkedIn Post'
      : format === 'twitter_thread'
        ? 'X / Twitter Thread'
        : 'Technical Article';

  return `You are CiteWriter's Content Planner Agent.
Your job is to synthesize raw research notes into a cohesive structural blueprint (ContentPlan) before the Writer begins.

FORMAT: ${formatName}
Target Audience: ${config.audience}
Target Tone: ${config.tone}
Target Word Count: ~${config.targetWords} words

CORE PLANNING RULES:
1. DIRECT ANSWER FIRST: Section 1 (or Tweet 1) must immediately answer the core question or prompt. Never open with vague throat-clearing.
2. PROGRESSIVE DISCLOSURE: Each section must build on the previous one. Follow a logical chain: Mechanism -> Impact -> Industry Solution -> Practical Takeaway.
3. REPETITION ERADICATION:
   - Identify redundant facts or numbers that appear across multiple notes (e.g. if multiple notes mention "30%", assign it to exactly ONE section).
   - List them explicitly in redundantInformation and avoid.
4. FORMAT BLUEPRINT:
   ${
     format === 'twitter_thread'
       ? '- For Twitter Thread: Create 5-8 sequential tweets (Tweet 1: Hook & Core Answer, Tweet 2: Physiological mechanism, Tweet 3: Environmental factor, Tweet 4: Psychological/acoustic factor, Tweet 5: Culinary adjustments, Tweet 6: Actionable takeaway). Never repeat the same stat.'
       : format === 'linkedin_post'
         ? '- For LinkedIn Post: Create 4-5 focused sections with clear takeaway bullets and industry perspective.'
         : '- For Technical Article: Create 4-6 detailed sections with clear, informative headings and word allocations.'
   }

Return a valid JSON object matching this schema:
{
  "centralAngle": "<one-sentence core thesis directly answering the topic>",
  "intendedTakeaway": "<what the reader should understand upon finishing>",
  "keyInsights": [
    "<3-5 non-overlapping progressive insights, each citing relevant note IDs like [n1]>"
  ],
  "narrativeFlow": [
    {
      "id": "<e.g. tweet-1 or section-1>",
      "heading": "<section title or tweet identifier>",
      "keyPoint": "<core concept and progression for this section>",
      "assignedNoteIds": ["n1", "n2"],
      "targetWords": <word count budget for this section>
    }
  ],
  "redundantInformation": [
    "<explicit warning of duplicate stats/ideas across notes to use only once>"
  ],
  "missingInformation": [
    "<aspects of prompt that notes do not cover>"
  ],
  "avoid": [
    "<angles, repeated stats, or cliches to strictly avoid>"
  ]
}`;
}

export function buildPlannerUserPrompt(
  topic: string,
  notes: Note[],
  config: RunConfig,
): string {
  const notesFormatted = notes
    .map((n) => `[${n.id}] Quote: "${n.quote}"\nSource: ${n.sourceUrl}`)
    .join('\n\n');

  return `Topic: "${topic}"
Target Format: ${config.format ?? 'article'}
Target Words: ${config.targetWords}

Available Research Notes:
${notesFormatted || '(No notes gathered)'}

Design a clean, non-repetitive ContentPlan following all instructions.`;
}
