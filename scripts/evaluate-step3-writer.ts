import dotenv from 'dotenv';
dotenv.config();

process.env.TOKEN_AUDIT = '1';

import fs from 'fs';
import path from 'path';
import { runResearcherAgent } from '../packages/core/src/agents/researcher/researcherAgent.js';
import { runWriterAgent } from '../packages/core/src/agents/writer/writerAgent.js';
import { runFactCheckerAgent } from '../packages/core/src/agents/factChecker/factCheckerAgent.js';
import { runEditorAgent } from '../packages/core/src/agents/editor/editorAgent.js';
import { GraphState } from '../packages/core/src/schemas/state.js';
import { getAgentModel, getAgentProvider, getAgentReasoningEffort } from '../packages/core/src/llm/client.js';

interface TopicEvalResult {
  topic: string;
  runId: string;
  notesCount: number;
  notes: Array<{ id: string; claim: string; sourceUrl: string }>;
  writer: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    latencyMs: number;
    claimsCount: number;
    draft: string;
  };
  factChecker: {
    totalClaims: number;
    supportedCount: number;
    unsupportedCount: number;
    needsMoreResearchCount: number;
    pass: boolean;
    checks: Array<{ claim: string; status: string; reason: string }>;
  };
  editor: {
    score: number;
    decision: string;
    citationCoverage: number;
    lengthCheck: boolean;
    pass: boolean;
    feedback: string;
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

async function evaluateTopic(topic: string, index: number): Promise<TopicEvalResult> {
  console.log('\n' + '='.repeat(70));
  console.log(`[Step 3 Evaluation] Topic ${index}: "${topic}"`);
  console.log('='.repeat(70));

  const runId = `step3-writer-eval-${index}-${Date.now()}`;
  console.log(`Run ID: ${runId}`);
  console.log(`Writer Provider/Model: ${getAgentProvider('writer')} / ${getAgentModel('writer')}`);
  console.log(`Writer Reasoning Effort: ${getAgentReasoningEffort('writer') || 'default'}`);

  const state: GraphState = {
    runId,
    topic,
    config: {
      audience: 'software engineers',
      tone: 'technical and precise',
      targetWords: 350,
    },
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

  // 1. Gather Notes with Researcher
  console.log('\n--- Step 1: Gathering verified notes with Researcher ---');
  const resResearcher = await runResearcherAgent(state);
  state.notes = resResearcher.notes;
  state.researchRounds = resResearcher.researchRounds;
  state.tokensUsed = resResearcher.tokensUsed;
  state.costUsd = resResearcher.costUsd;
  console.log(`Gathered ${state.notes.length} verified notes.`);

  // 2. Generate Draft with Writer (reasoning_effort: none)
  console.log('\n--- Step 2: Generating draft with Writer (WRITER_REASONING_EFFORT=none) ---');
  const startWriter = Date.now();
  const resWriter = await runWriterAgent(state);
  const writerLatencyMs = Date.now() - startWriter;
  state.draft = resWriter.draft;
  state.claims = resWriter.claims;
  state.writeCycles = resWriter.writeCycles;
  state.tokensUsed = resWriter.tokensUsed;
  state.costUsd = resWriter.costUsd;

  const writerAudit = getLastAuditCall(runId, 'writer');
  const writerInputTokens = writerAudit?.input_tokens ?? 0;
  const writerOutputTokens = writerAudit?.output_tokens ?? 0;
  const writerReasoningTokens = writerAudit?.reasoning_tokens ?? 0;

  console.log(`Writer execution complete in ${writerLatencyMs}ms`);
  console.log(`  Input tokens:     ${writerInputTokens}`);
  console.log(`  Output tokens:    ${writerOutputTokens}`);
  console.log(`  Reasoning tokens: ${writerReasoningTokens}`);
  console.log(`  Claims parsed:    ${state.claims.length}`);
  console.log(`  Draft Preview:\n${state.draft.slice(0, 300)}...\n`);

  // 3. Fact-Checker Verification
  console.log('--- Step 3: Verifying claims with Fact-Checker ---');
  const resFactChecker = await runFactCheckerAgent(state);
  state.claimChecks = resFactChecker.claimChecks;
  state.tokensUsed = resFactChecker.tokensUsed;
  state.costUsd = resFactChecker.costUsd;

  const supported = state.claimChecks.filter((c) => c.status === 'supported').length;
  const unsupported = state.claimChecks.filter((c) => c.status === 'unsupported').length;
  const needsMore = state.claimChecks.filter((c) => c.status === 'needs_more_research').length;
  const factCheckerPass = unsupported === 0 && needsMore === 0;

  console.log(`Fact-Checker Results:`);
  console.log(`  Total claims checked:   ${state.claimChecks.length}`);
  console.log(`  Supported:             ${supported}`);
  console.log(`  Unsupported:           ${unsupported}`);
  console.log(`  Needs more research:   ${needsMore}`);
  console.log(`  Passes Fact-Checker:   ${factCheckerPass ? 'YES' : 'NO'}`);

  // 4. Editor Evaluation
  console.log('\n--- Step 4: Editorial review with Editor ---');
  const resEditor = await runEditorAgent(state);
  state.editorVerdict = resEditor.editorVerdict;
  state.tokensUsed = resEditor.tokensUsed;
  state.costUsd = resEditor.costUsd;

  const editorPass = state.editorVerdict?.decision === 'accept';
  console.log(`Editor Results:`);
  console.log(`  Score:                 ${state.editorVerdict?.score}/10`);
  console.log(`  Decision:              ${state.editorVerdict?.decision}`);
  console.log(`  Citation Coverage:     ${state.editorVerdict?.citationCoverage}%`);
  console.log(`  Length Check Passed:   ${state.editorVerdict?.lengthCheckPassed}`);
  console.log(`  Passes Editor:         ${editorPass ? 'YES' : 'REVISION REQUESTED'}`);
  console.log(`  Feedback:              ${state.editorVerdict?.feedback}`);

  return {
    topic,
    runId,
    notesCount: state.notes.length,
    notes: state.notes.map((n) => ({ id: n.id, claim: n.claim, sourceUrl: n.sourceUrl })),
    writer: {
      inputTokens: writerInputTokens,
      outputTokens: writerOutputTokens,
      reasoningTokens: writerReasoningTokens,
      latencyMs: writerLatencyMs,
      claimsCount: state.claims.length,
      draft: state.draft,
    },
    factChecker: {
      totalClaims: state.claimChecks.length,
      supportedCount: supported,
      unsupportedCount: unsupported,
      needsMoreResearchCount: needsMore,
      pass: factCheckerPass,
      checks: state.claimChecks.map((c) => ({ claim: c.claim, status: c.status, reason: c.reason })),
    },
    editor: {
      score: state.editorVerdict?.score ?? 0,
      decision: state.editorVerdict?.decision ?? 'unknown',
      citationCoverage: state.editorVerdict?.citationCoverage ?? 0,
      lengthCheck: state.editorVerdict?.lengthCheckPassed ?? false,
      pass: editorPass,
      feedback: state.editorVerdict?.feedback ?? '',
    },
  };
}

async function main() {
  console.log('#################################################################');
  console.log('  STARTING STEP 3 EVALUATION: WRITER REASONING EFFORT = NONE');
  console.log('#################################################################');

  const topic1 = 'Advances in TypeScript 5.0 Type Inference';
  const topic2 = 'HTTP/3 QUIC protocol connection migration performance';

  const res1 = await evaluateTopic(topic1, 1);

  console.log('\n[Pacing Pause] Waiting 15s before topic 2 to drain rate-limit buckets...');
  await new Promise((r) => setTimeout(r, 15000));

  const res2 = await evaluateTopic(topic2, 2);

  // Write results to disk for inspection
  const outPath = path.resolve(process.cwd(), 'token-audit/step3-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ res1, res2 }, null, 2));

  console.log('\n' + '#'.repeat(70));
  console.log('  STEP 3 EVALUATION RUN COMPLETE');
  console.log(`  Saved detailed results to ${outPath}`);
  console.log('#'.repeat(70));
}

main().catch((err) => {
  console.error('Step 3 evaluation failed:', err);
  process.exit(1);
});

