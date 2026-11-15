import dotenv from 'dotenv';
dotenv.config();

process.env.TOKEN_AUDIT = '1';

import fs from 'fs';
import path from 'path';
import { generateStructuredOutput } from '../packages/core/src/llm/structuredOutput.js';
import { createLLMClient, getAgentModel, getAgentMaxTokens, getAgentReasoningEffort } from '../packages/core/src/llm/client.js';
import { buildResearcherSystemPrompt, buildResearcherInitialPrompt } from '../packages/core/src/agents/researcher/prompt.js';
import { ResearcherOutputSchema } from '../packages/core/src/agents/researcher/researcherAgent.js';
import { filterVerifiedNotes } from '../packages/core/src/agents/researcher/quoteVerifier.js';
import { runWriterAgent } from '../packages/core/src/agents/writer/writerAgent.js';
import { runFactCheckerAgent } from '../packages/core/src/agents/factChecker/factCheckerAgent.js';
import { runEditorAgent } from '../packages/core/src/agents/editor/editorAgent.js';
import { GraphState } from '../packages/core/src/schemas/state.js';
import { resolveBudgetLimits } from '../packages/core/src/llm/budget.js';

interface ExperimentResult {
  name: string;
  notesCount: number;
  claimsCount: number;
  factChecker: {
    supported: number;
    unsupported: number;
    needsMoreResearch: number;
    sum: number;
    checks: Array<{ claim: string; status: string; reason: string }>;
  };
  editor: {
    score: number;
    decision: string;
    feedback: string;
  };
  tokens: {
    researcher: { in: number; out: number; reasoning: number; total: number };
    writer: { in: number; out: number; reasoning: number; total: number };
    factChecker: { in: number; out: number; reasoning: number; total: number };
    editor: { in: number; out: number; reasoning: number; total: number };
    totalRun: number;
  };
}

function getLastAuditCall(runId: string, agentName: string) {
  const auditPath = path.resolve(process.cwd(), 'token-audit/calls.jsonl');
  if (!fs.existsSync(auditPath)) return null;
  const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const record = JSON.parse(lines[i]);
      if (record.run_id === runId && record.agent_name === agentName) {
        return record;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function runResearcherOnCachedPages(
  topic: string,
  runId: string,
  mode: 'passage_selection' | 'head_truncation',
  cachedPages: Array<{ url: string; title: string; rawText: string; wrappedText: string }>,
) {
  const client = createLLMClient({ role: 'researcher' });
  const model = getAgentModel('researcher');

  let userPrompt = '';
  if (mode === 'passage_selection') {
    userPrompt = buildResearcherInitialPrompt(topic, cachedPages, { tokenBudget: 500 });
  } else {
    // Old 4000-char head-truncation
    const pagesFormatted = cachedPages
      .slice(0, 5)
      .map((p, i) => {
        const content =
          p.wrappedText.length > 4000
            ? p.wrappedText.slice(0, 4000) +
              '\n... [truncated for brevity]\n<<<END_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>'
            : p.wrappedText;
        return `### Document ${i + 1} (URL: ${p.url})\n${content}`;
      })
      .join('\n\n');
    userPrompt = `Topic of Research: "${topic}"\n\nBelow are the primary web documents retrieved for this topic:\n\n${pagesFormatted}\n\nExtract thorough, verifiable factual notes covering technical specifications, architectural changes, syntax rules, and performance metrics.`;
  }

  const systemPrompt = buildResearcherSystemPrompt();
  const budgetLimits = resolveBudgetLimits({ maxTokens: 100000, maxCostUsd: 1.5 });

  const result = await generateStructuredOutput({
    client,
    model,
    schema: ResearcherOutputSchema,
    systemPrompt,
    userPrompt,
    currentTokensUsed: 0,
    currentCostUsd: 0,
    budgetLimits,
    runId,
    agentRole: 'researcher',
    maxTokens: 2000,
    reasoningEffort: 'low',
  });

  const rawTextsByUrl = new Map<string, string>();
  for (const p of cachedPages) {
    rawTextsByUrl.set(p.url, p.rawText);
  }

  const verification = filterVerifiedNotes(result.data.notes, rawTextsByUrl);

  const notes = verification.verifiedNotes.map((n, i) => ({
    ...n,
    id: `n${i + 1}`,
  }));

  return { notes, tokensUsed: result.tokens.totalTokens, costUsd: result.costUsd };
}

async function runIsolatingVariant(
  variantName: string,
  runId: string,
  researcherMode: 'passage_selection' | 'head_truncation',
  writerReasoning: 'low' | 'none',
  cachedPages: any[],
): Promise<ExperimentResult> {
  const topic = 'Advances in TypeScript 5.0 Type Inference';
  console.log(`\n============================================================`);
  console.log(`RUNNING VARIANT: ${variantName}`);
  console.log(`  Researcher: ${researcherMode}`);
  console.log(`  Writer Reasoning: ${writerReasoning}`);
  console.log(`============================================================`);

  const state: GraphState = {
    runId,
    topic,
    config: { audience: 'software engineers', tone: 'technical and precise', targetWords: 350 },
    notes: [],
    researchRounds: 0,
    draft: '',
    claims: [],
    writeCycles: 0,
    claimChecks: [],
    tokensUsed: 0,
    costUsd: 0,
    status: 'running',
    openIssues: [],
  };

  // 1. Researcher
  console.log('Step 1: Running Researcher...');
  const resR = await runResearcherOnCachedPages(topic, runId, researcherMode, cachedPages);
  state.notes = resR.notes;
  state.researchRounds = 1;
  state.tokensUsed = resR.tokensUsed;
  state.costUsd = resR.costUsd;
  console.log(`  Verified Notes produced: ${state.notes.length}`);

  // 2. Writer
  console.log(`Step 2: Running Writer (reasoning_effort: ${writerReasoning})...`);
  const resW = await runWriterAgent(state, {
    reasoningEffort: writerReasoning,
    maxTokens: 2500,
  });
  state.draft = resW.draft;
  state.claims = resW.claims;
  state.writeCycles = resW.writeCycles;
  state.tokensUsed = resW.tokensUsed;
  state.costUsd = resW.costUsd;
  console.log(`  Claims drafted: ${state.claims.length}`);

  // 3. Fact-Checker
  console.log('Step 3: Running Fact-Checker...');
  const resFC = await runFactCheckerAgent(state, {
    maxTokens: 2500,
    reasoningEffort: 'low',
  });
  state.claimChecks = resFC.claimChecks;
  state.tokensUsed = resFC.tokensUsed;
  state.costUsd = resFC.costUsd;

  const supported = state.claimChecks.filter((c) => c.status === 'supported').length;
  const unsupported = state.claimChecks.filter((c) => c.status === 'unsupported').length;
  const needsMore = state.claimChecks.filter((c) => c.status === 'needs_more_research').length;
  console.log(`  Fact-Checker result: ${supported} supported, ${unsupported} unsupported, ${needsMore} needs_more_research (Sum: ${supported + unsupported + needsMore}/${state.claims.length})`);

  // 4. Editor
  console.log('Step 4: Running Editor...');
  const resE = await runEditorAgent(state, {
    maxTokens: 600,
  });
  state.editorVerdict = resE.editorVerdict;
  state.tokensUsed = resE.tokensUsed;
  state.costUsd = resE.costUsd;
  console.log(`  Editor Score: ${state.editorVerdict?.score}, Decision: ${state.editorVerdict?.decision}`);

  // Fetch token counts from audit log
  const rAudit = getLastAuditCall(runId, 'researcher');
  const wAudit = getLastAuditCall(runId, 'writer');
  const fcAudit = getLastAuditCall(runId, 'factChecker');
  const edAudit = getLastAuditCall(runId, 'editor');

  const tokens = {
    researcher: {
      in: rAudit?.input_tokens ?? 0,
      out: rAudit?.output_tokens ?? 0,
      reasoning: rAudit?.reasoning_tokens ?? 0,
      total: (rAudit?.input_tokens ?? 0) + (rAudit?.output_tokens ?? 0),
    },
    writer: {
      in: wAudit?.input_tokens ?? 0,
      out: wAudit?.output_tokens ?? 0,
      reasoning: wAudit?.reasoning_tokens ?? 0,
      total: (wAudit?.input_tokens ?? 0) + (wAudit?.output_tokens ?? 0),
    },
    factChecker: {
      in: fcAudit?.input_tokens ?? 0,
      out: fcAudit?.output_tokens ?? 0,
      reasoning: fcAudit?.reasoning_tokens ?? 0,
      total: (fcAudit?.input_tokens ?? 0) + (fcAudit?.output_tokens ?? 0),
    },
    editor: {
      in: edAudit?.input_tokens ?? 0,
      out: edAudit?.output_tokens ?? 0,
      reasoning: edAudit?.reasoning_tokens ?? 0,
      total: (edAudit?.input_tokens ?? 0) + (edAudit?.output_tokens ?? 0),
    },
    totalRun: 0,
  };
  tokens.totalRun =
    tokens.researcher.total + tokens.writer.total + tokens.factChecker.total + tokens.editor.total;

  return {
    name: variantName,
    notesCount: state.notes.length,
    claimsCount: state.claims.length,
    factChecker: {
      supported,
      unsupported,
      needsMoreResearch: needsMore,
      sum: supported + unsupported + needsMore,
      checks: state.claimChecks.map((c) => ({
        claim: c.claim,
        status: c.status,
        reason: c.reason,
      })),
    },
    editor: {
      score: state.editorVerdict?.score ?? 0,
      decision: state.editorVerdict?.decision ?? 'unknown',
      feedback: state.editorVerdict?.feedback ?? '',
    },
    tokens,
  };
}

async function main() {
  const cachedPath = path.resolve(process.cwd(), 'token-audit/topic1-cached-pages.json');
  if (!fs.existsSync(cachedPath)) {
    throw new Error(`Cached pages not found at ${cachedPath}`);
  }
  const cachedPages = JSON.parse(fs.readFileSync(cachedPath, 'utf8'));

  // Variant A: Writer reasoning low + Passage selection
  const runIdA = `iso-exp-a-${Date.now()}`;
  const resultA = await runIsolatingVariant(
    'Variant (a): Writer reasoning low + Passage selection',
    runIdA,
    'passage_selection',
    'low',
    cachedPages,
  );

  console.log('\n[Pacing Pause] Waiting 15s between isolating runs...');
  await new Promise((r) => setTimeout(r, 15000));

  // Variant B: Writer reasoning none + Old head-truncation
  const runIdB = `iso-exp-b-${Date.now()}`;
  const resultB = await runIsolatingVariant(
    'Variant (b): Writer reasoning none + Old head-truncation',
    runIdB,
    'head_truncation',
    'none',
    cachedPages,
  );

  const outPath = path.resolve(process.cwd(), 'token-audit/isolating-experiment-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ resultA, resultB }, null, 2));
  console.log(`\nIsolating experiment results saved to ${outPath}`);
}

main().catch(console.error);
