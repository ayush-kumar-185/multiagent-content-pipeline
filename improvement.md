# Task: Upgrade CiteWriter into a High-Quality, Evidence-Grounded Content Generation System

You are a senior AI systems engineer, LangGraph architect, TypeScript engineer, and content quality specialist.

Your task is to inspect, improve, and implement enhancements in my existing project, **CiteWriter**.

This is an existing multi-agent content generation system. Do not blindly rewrite the architecture. First understand the codebase, identify existing implementations, and improve them while preserving working functionality.

Your objective is to make CiteWriter generate content that is:

1. Factually accurate and evidence-grounded.
2. Informative and genuinely useful to readers.
3. Logically structured with a clear narrative progression.
4. Engaging without clickbait or artificial storytelling.
5. Concise, with minimal repetition and filler.
6. Appropriate for its requested publication format.
7. Fully traceable to its research sources.

The ultimate goal is NOT simply to generate grammatically correct or citation-heavy content.

**The goal is to generate content that people actually find valuable to read.**

---

# PART 1: UNDERSTAND THE EXISTING PROJECT

Before making changes, inspect:

- Monorepo structure and package dependencies.
- `packages/core` and its LangGraph implementation.
- All four existing agents.
- Shared GraphState and Zod schemas.
- Research and web-fetching tools.
- Writer prompts and revision logic.
- Fact-checker prompts and deterministic validation.
- Editor prompts and scoring implementation.
- Research and writing retry loops.
- Human review and interrupt implementation.
- `packages/evals` and existing benchmarks.
- API, SSE, persistence, and frontend dependencies.
- Existing tests and architecture decision records.

Read the relevant documentation, especially:
- `docs/DECISIONS.md`
- `docs/FAILURES.md`
- `docs/API.md`

Do not assume that the architecture documentation perfectly reflects the current code.

Inspect actual implementations before deciding what to change.

Produce a concise implementation plan based on existing code.

Do not stop after producing the plan. Proceed to implementation.

# PART 2: IMPROVE THE RESEARCHER AGENT

## Problem

The current Researcher gathers objective facts and produces atomic citable notes.

However, gathering multiple facts does not guarantee that the final content has sufficient depth, variety, or interesting insights.

The Researcher should gather evidence that supports a coherent and informative piece of content.

## Required improvements

Introduce a structured research plan.

Suggested schema:

```typescript
interface ResearchPlan {
  centralQuestion: string;
  subQuestions: string[];

  requiredEvidence: (
    | "scientific_finding"
    | "mechanism"
    | "statistics"
    | "real_world_example"
    | "counterpoint"
    | "practical_implication"
  )[];
}
```

The plan must be generated from the user's topic, requested format, audience, and available configuration.

These evidence categories are research targets, not mandatory facts. Never fabricate missing information to satisfy coverage requirements.

Improve research-note metadata.

Suggested schema:

```typescript
interface Note {
  id: string;
  claim: string;
  sourceUrl: string;
  quote: string;
  retrievedAt: string;

  sourceTitle: string;
  publisher: string;
  publishedAt?: string;

  sourceType:
    | "primary_research"
    | "official_report"
    | "expert_interview"
    | "reputable_publication"
    | "other";

  researchCategory: string;
}
```

Adapt this to the existing schema instead of unnecessarily breaking compatibility.

### Researcher requirements

- Prioritize primary research, official sources, and authoritative publications.
- Track source provenance and publication dates.
- Identify multiple independent sources when appropriate.
- Avoid collecting several notes that communicate the same fact.
- Identify contradictory or qualifying evidence.
- Identify missing research areas.
- Preserve exact quote verification.
- Maintain existing page-fetch limits and security protections.
- Re-research only the specific claims that need additional evidence.
- Never invent sources, quotes, publication dates, or findings.

Remember: An exact quote substring proves textual existence, not semantic support.

# PART 3: INTRODUCE A CONTENT PLANNER NODE

This is a major improvement.

Currently, the Writer receives research notes and immediately starts writing.

Introduce a Content Planner between the Researcher and Writer.

The planner must decide:

- What is the central angle of the content?
- What should the reader learn?
- Which research findings are most valuable?
- What information is genuinely surprising or useful?
- Which facts are redundant?
- What is the best narrative progression?
- Which information deserves more attention?
- What information should be excluded?

Suggested output:

```typescript
interface ContentPlan {
  centralAngle: string;

  targetAudience: string;
  intendedTakeaway: string;

  keyInsights: string[];

  narrativeFlow: {
    section: string;
    purpose: string;
    relevantNoteIds: string[];
  }[];

  redundantInformation: string[];

  missingInformation: string[];

  avoid: string[];
}
```

Requirements:

1. Every planned section should have a distinct purpose.
2. Map planned sections to actual research-note IDs.
3. Never create factual content in the planner.
4. Do not force every research note into the final output.
5. Do not invent insights that are unsupported by the research.
6. Adapt planning to the requested content format.
7. Keep the planner deterministic in its position within the graph, even if its internal reasoning uses an LLM.

# PART 4: IMPROVE THE WRITER AGENT

The Writer must receive:

- Original topic.
- User configuration.
- Research notes.
- Content plan.
- Previous fact-check feedback, if revising.
- Previous editor feedback, if revising.

## Core writing requirements

The Writer must:

1. Answer the user's actual question.
2. Follow the central angle defined by the planner.
3. Prioritize the most informative research.
4. Explain why facts matter instead of merely listing them.
5. Build a logical progression between sections.
6. Use concrete examples when supported by research.
7. Avoid generic introductions and conclusions.
8. Avoid repeating statistics or explanations.
9. Remove filler sentences.
10. Maintain the requested tone and audience level.
11. Preserve citations for every factual claim.
12. Never introduce unsupported factual statements.

### Important change: Do not force coverage of every research note.

The Writer should select the most relevant notes.

Every included note must contribute a distinct insight, explanation, example, qualification, or necessary context.

Unused research notes are acceptable.

### Citation requirements

Preserve the existing citation format:

`[n1]`, `[n2]`, `[n1][n3]`

Every factual sentence must have relevant citations.

Do not attach citations simply because a note is topically related. The note must actually support the sentence.

# PART 5: UPGRADE THE FACT-CHECKER

Preserve the existing deterministic validation layer.

Expand claim classification.

Suggested status:

```typescript
type ClaimStatus =
  | "supported"
  | "partially_supported"
  | "unsupported"
  | "contradicted"
  | "needs_more_research";
```

Add checks for:

1. Unsupported numerical claims.
2. Unsupported dates and statistics.
3. Overgeneralization.
4. Incorrect causal conclusions.
5. Misleading qualifiers.
6. Compound claims containing multiple factual assertions.
7. Missing citations.
8. Invalid citation IDs.
9. Contradictions between research notes.
10. Claims that are more specific than their sources.

Distinguish between:
- Source contains the quoted text.
- Source supports the stated claim.
- Source supports the full scope of the stated claim.

Do not treat these as equivalent.

If a sentence contains multiple independent factual claims, ensure each claim has appropriate evidence.

After any revision that changes factual statements, parse and verify the revised draft again.

Do not allow the quality evaluator to override fact-checking failures.

# PART 6: REDESIGN THE EDITOR AND QUALITY SCORING SYSTEM

The existing Editor returns a single score, feedback, and accept/revise decision.

This is insufficient to evaluate content quality.

Replace or extend the existing scoring model with structured evaluation.

Suggested schema:

```typescript
interface EditorVerdict {
  overallScore: number;

  scores: {
    relevance: number;
    factualReliability: number;
    depth: number;
    originality: number;
    logicalFlow: number;
    engagement: number;
    readability: number;
    repetitionControl: number;
    usefulness: number;
    conclusionQuality: number;
  };

  strengths: string[];
  weaknesses: string[];

  missingInformation: string[];

  redundantSections: string[];

  revisionInstructions: {
    section: string;
    issue: string;
    action: string;
  }[];

  decision: "accept" | "revise" | "reject";
}
```

All category scores should be between 0 and 10.

## Weighted scoring rubric

Use this initial weighting:

| Dimension | Weight |
|---|---:|
| Factual reliability | 20% |
| Relevance | 15% |
| Depth and usefulness | 15% |
| Logical progression | 10% |
| Originality | 10% |
| Engagement | 10% |
| Repetition control | 10% |
| Readability | 5% |
| Conclusion quality | 5% |

Overall score must be calculated deterministically in TypeScript using validated category scores and weights.

Do not ask an LLM to calculate the final weighted arithmetic.

## Quality thresholds

- 9.0–10: Exceptional.
- 8.0–8.9: Strong.
- 7.0–7.9: Acceptable.
- 6.0–6.9: Needs revision.
- Below 6.0: Poor.

These thresholds are initial defaults and should be configurable.

## Hard quality gates

Weighted scoring must not hide serious problems.

Implement configurable hard gates:

- Unsupported material factual claim: do not accept.
- Fabricated citation: do not accept.
- Missing central answer: mandatory revision.
- Severe semantic repetition: mandatory revision.
- Major format violation: mandatory revision.
- Weak engagement alone: revision, not factual rejection.

The decision must consider both the overall score and hard-gate results.

The LLM should provide the individual assessments and reasons. TypeScript should validate scores, calculate the final score, and enforce hard gates.

# PART 7: IMPLEMENT SEMANTIC REPETITION DETECTION

This is particularly important.

The airplane-food example showed significant repetition.

Tweets 1, 8, 9, and 10 repeatedly communicated the same 30% reduction in sweet and salty taste sensitivity.

The system must identify semantic duplication, not just identical wording.

Implement a repetition evaluation layer that checks:

- Repeated statistics.
- Repeated explanations.
- Repeated conclusions.
- Sections that add no new information.
- Multiple paragraphs expressing the same insight.
- Sentences that merely rephrase earlier sentences.

Do not automatically remove text based only on lexical similarity.

Use semantic assessment, supported by deterministic text-similarity techniques where appropriate.

Return structured findings:

```typescript
interface RepetitionFinding {
  sectionIds: string[];
  repeatedIdea: string;
  severity: "low" | "medium" | "high";
  recommendation: "remove" | "merge" | "rewrite";
}
```

The evaluator should distinguish necessary reinforcement from unnecessary repetition.

Do not penalize a conclusion merely for summarizing the main argument. Penalize it when it provides no meaningful synthesis or takeaway.

# PART 8: ADD FORMAT-SPECIFIC EVALUATION

CiteWriter supports:

- Technical articles.
- LinkedIn posts.
- X/Twitter threads.

Do not apply identical editorial rules to all formats.

## Technical articles

Prioritize:
- Technical depth.
- Evidence quality.
- Clear explanations.
- Section organization.
- Logical argumentation.
- Useful conclusions.

## LinkedIn posts

Prioritize:
- Strong opening.
- Professional relevance.
- Readability.
- Practical insights.
- Concise storytelling.
- Meaningful takeaway.

Avoid artificial motivational language.

## X/Twitter threads

Prioritize:
- Strong first tweet.
- Curiosity.
- Information density.
- Distinct value in each tweet.
- Natural transitions.
- Conciseness.
- Strong final takeaway.

For X threads, explicitly check:

1. Does the opening create a reason to continue?
2. Does each tweet introduce new information?
3. Can any tweet be removed without losing meaningful information?
4. Is the thread logically connected?
5. Are the best insights distributed effectively?
6. Does the ending add value?

Do not force unnecessary CTAs.

Make the rubric configurable according to content format.

# PART 9: IMPROVE THE REVISION LOOP

Keep the existing bounded retry architecture.

However, make revision feedback specific and actionable.

Bad feedback:

"Improve the structure and engagement."

Good feedback:

"Sections 8 and 9 repeat the main finding already established in section 1. Remove the duplication and use the available research notes to introduce a genuinely new insight."

Requirements:

- Fact-checking failures must be routed to the appropriate research or writing path.
- Editorial failures must be routed to the Writer.
- Repetition failures must include exact section references.
- The Writer should preserve previously verified claims where possible.
- Changed factual claims must be revalidated.
- Revisions must not exceed configured iteration limits.
- Track why each revision occurred.
- Prevent repeated revisions for the same unresolved issue.

Preserve the existing human-review interrupt.

If quality thresholds are not met after maximum iterations, send the result to human review with clearly visible warnings. Never silently mark poor content as approved.

# PART 10: IMPROVE THE EVALUATION FRAMEWORK

Upgrade `packages/evals`.

Build a benchmark dataset containing at least 30–50 diverse topics.

Include:
- Science.
- Technology.
- History.
- Business.
- General education.
- Health and wellness.
- Everyday curiosity questions.

Ensure that topics have appropriate research and source availability.

Measure:

1. Claim support rate.
2. Citation validity.
3. Citation relevance.
4. Research coverage.
5. Semantic repetition.
6. Topic relevance.
7. Information density.
8. Readability.
9. Format adherence.
10. Overall editorial quality.
11. Cost per generation.
12. Latency.
13. Revision improvement.

## Required experiments

Compare:

A. Single-prompt baseline LLM.

B. Existing CiteWriter architecture.

C. CiteWriter with Content Planner.

D. Fully upgraded CiteWriter.

Measure whether each additional component improves output quality enough to justify its cost and latency.

Do not fabricate benchmark results.

Store results in reproducible evaluation reports.

# PART 11: FRONTEND IMPROVEMENTS

Preserve the existing frontend and audit drawer.

Enhance the UI to display:

- Overall content quality score.
- Individual quality dimension scores.
- Research coverage.
- Repetition warnings.
- Unsupported claims.
- Missing information.
- Editor feedback.
- Revision history.
- Per-agent cost and latency.

Allow the user to understand WHY the content received its score.

Do not hide critical factual or editorial warnings behind a single overall score.

Keep citation inspection and human approval functionality intact.

# PART 12: TECHNICAL AND ARCHITECTURAL CONSTRAINTS

These requirements are mandatory.

1. TypeScript strict mode.
2. Zod validation for all agent outputs.
3. Preserve LangGraph state-machine architecture.
4. Preserve deterministic routing.
5. Preserve BullMQ, Redis, PostgreSQL and SSE functionality.
6. Preserve durable checkpointing.
7. Preserve existing security protections.
8. Preserve SSRF protection and prompt-injection isolation.
9. Preserve mock and real LLM execution modes.
10. Preserve provider-agnostic model configuration.
11. Preserve existing public API contracts unless a versioned change is necessary.
12. Preserve human review and approval workflows.
13. Do not introduce unnecessary agents.
14. Avoid excessive LLM calls.
15. Prefer deterministic code for scoring, thresholds, validation, and routing.
16. Keep prompts centralized and maintainable.
17. Add unit, integration, and regression tests.
18. Avoid breaking existing tests.

Do not introduce a new dependency unless it provides a clear benefit.

Do not store unnecessary generated data in GraphState. Keep state serializable and compatible with PostgreSQL checkpointing.

# PART 13: TESTING REQUIREMENTS

Use the existing test framework.

Add tests for:

- ResearchPlan validation.
- ContentPlan validation.
- Note metadata validation.
- Claim status classification.
- Compound claim verification.
- Repetition detection.
- Weighted score calculation.
- Hard quality gates.
- Format-specific scoring.
- Revision routing.
- Revision loop limits.
- Revalidation after writing revisions.
- Human review fallback.
- Mock-mode determinism.
- Real-mode provider integration where practical.

Create a regression test using this topic:

"Why Airplane Food Tastes Different and Bland at 35,000 Feet"

Use it to test whether the upgraded pipeline:

- Avoids repeating the 30% statistic.
- Distinguishes evidence from inference.
- Explains the research without overgeneralization.
- Introduces airline examples only when supported.
- Maintains logical narrative progression.
- Produces a useful conclusion.
- Preserves citations on factual claims.

Do not hardcode an expected factual answer into the Writer.

Use verified research fixtures for deterministic tests.

# PART 14: IMPLEMENTATION PROCESS

Follow this exact workflow.

### Step 1: Audit

Inspect the complete repository and document the current implementation.

Identify:
- Existing reusable components.
- Missing features.
- Schema changes required.
- Potential breaking changes.
- Relevant tests.

### Step 2: Implementation plan

Create a prioritized plan.

Separate:
- Essential changes.
- Optional improvements.
- Risky architectural changes.

### Step 3: Implement incrementally

Implement the highest-priority changes first.

Recommended order:

1. Structured Editor scoring.
2. Semantic repetition evaluation.
3. Actionable revision feedback.
4. Writer prompt improvements.
5. Content Planner.
6. Researcher improvements.
7. Fact-checker improvements.
8. Format-specific evaluation.
9. Benchmark expansion.
10. Frontend enhancements.

Adapt the sequence if repository dependencies require a different order.

### Step 4: Test

Run:
- Type checking.
- Linting.
- Unit tests.
- Integration tests.
- Existing regression tests.
- Mock-mode end-to-end tests.

Fix regressions before proceeding.

### Step 5: Report

At completion, provide:

1. Files changed.
2. New features implemented.
3. Architecture changes.
4. New schemas and contracts.
5. Tests added.
6. Test results.
7. Known limitations.
8. Remaining work.
9. Example before/after output if real LLM execution is available.
10. Any database migration or environment-variable changes required.

Clearly distinguish implemented features from planned features.

Never claim tests passed unless they were actually executed.

---

# FINAL ACCEPTANCE CRITERIA

The work is successful only when:

- CiteWriter continues to produce properly cited content.
- Every factual claim remains traceable to research evidence.
- Content planning improves information selection and narrative structure.
- Redundant sections are detected.
- The Editor provides explainable, dimension-specific scores.
- The Writer receives precise revision instructions.
- Format-specific evaluation works.
- Revised factual content is revalidated.
- Existing infrastructure and human review remain functional.
- Automated tests cover the new functionality.
- Evaluation results can demonstrate whether content quality actually improved.

**Most important engineering principle:**

Do not make CiteWriter more complicated merely to make it look more intelligent.

Make it measurably better at producing accurate, informative, original, well-structured, and useful content.

Start by inspecting the existing repository, then implement the improvements directly. Do not stop at recommendations or pseudocode.