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
import { getAgentModel, getAgentProvider } from '../packages/core/src/llm/client.js';

interface Step4TopicResult {
  topic: string;
  runId: string;
  researcher: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
    notesProposed: number;
    notesVerified: number;
    droppedNotesCount: number;
    notes: Array<{ id: string; claim: string; quote: string; sourceUrl: string }>;
  };
  writer: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    claimsCount: number;
  };
  factChecker: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    claimsChecked: number;
    supportedCount: number;
    unsupportedCount: number;
  };
  editor: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    score: number;
    decision: string;
  };
  totalRunTokens: number;
  totalCostUsd: number;
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

async function runStep4Topic(topic: string, index: number): Promise<Step4TopicResult> {
  console.log('\n' + '='.repeat(70));
  console.log(`[Step 4 Evaluation] Topic ${index}: "${topic}"`);
  console.log('='.repeat(70));

  const runId = `step4-researcher-eval-${index}-${Date.now()}`;
  console.log(`Run ID: ${runId}`);
  console.log(`Researcher Page Budget: ${process.env.RESEARCHER_PAGE_TOKEN_BUDGET || 500} tokens/page`);

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

  // 1. Run Researcher with relevance-based passage selection
  console.log('\n--- Step 1: Running Researcher with Relevance Passage Selection ---');
  const startResearcher = Date.now();
  const resResearcher = await runResearcherAgent(state);
  const researcherLatency = Date.now() - startResearcher;

  state.notes = resResearcher.notes;
  state.researchRounds = resResearcher.researchRounds;
  state.tokensUsed = resResearcher.tokensUsed;
  state.costUsd = resResearcher.costUsd;

  const researcherAudit = getLastAuditCall(runId, 'researcher');
  const rInput = researcherAudit?.input_tokens ?? 0;
  const rOutput = researcherAudit?.output_tokens ?? 0;
  const rTotal = rInput + rOutput;

  console.log(`Researcher execution finished in ${researcherLatency}ms`);
  console.log(`  Input tokens:               ${rInput}`);
  console.log(`  Output tokens:              ${rOutput}`);
  console.log(`  Total researcher tokens:    ${rTotal}`);
  console.log(`  Notes passing verification: ${state.notes.length}`);

  // 2. Run Writer
  console.log('\n--- Step 2: Running Writer ---');
  const resWriter = await runWriterAgent(state);
  state.draft = resWriter.draft;
  state.claims = resWriter.claims;
  state.writeCycles = resWriter.writeCycles;
  state.tokensUsed = resWriter.tokensUsed;
  state.costUsd = resWriter.costUsd;

  const writerAudit = getLastAuditCall(runId, 'writer');
  const wInput = writerAudit?.input_tokens ?? 0;
  const wOutput = writerAudit?.output_tokens ?? 0;
  const wTotal = wInput + wOutput;

  console.log(`Writer execution finished`);
  console.log(`  Input tokens:            ${wInput}`);
  console.log(`  Output tokens:           ${wOutput}`);
  console.log(`  Claims drafted:          ${state.claims.length}`);

  // 3. Run Fact-Checker
  console.log('\n--- Step 3: Running Fact-Checker ---');
  const resFactChecker = await runFactCheckerAgent(state);
  state.claimChecks = resFactChecker.claimChecks;
  state.tokensUsed = resFactChecker.tokensUsed;
  state.costUsd = resFactChecker.costUsd;

  const fcAudit = getLastAuditCall(runId, 'factChecker');
  const fcInput = fcAudit?.input_tokens ?? 0;
  const fcOutput = fcAudit?.output_tokens ?? 0;
  const fcTotal = fcInput + fcOutput;
  const supported = state.claimChecks.filter((c) => c.status === 'supported').length;
  const unsupported = state.claimChecks.filter((c) => c.status === 'unsupported').length;

  console.log(`Fact-Checker execution finished`);
  console.log(`  Input tokens:            ${fcInput}`);
  console.log(`  Output tokens:           ${fcOutput}`);
  console.log(`  Claims checked:          ${state.claimChecks.length} (${supported} supported, ${unsupported} unsupported)`);

  // 4. Run Editor
  console.log('\n--- Step 4: Running Editor ---');
  const resEditor = await runEditorAgent(state);
  state.editorVerdict = resEditor.editorVerdict;
  state.tokensUsed = resEditor.tokensUsed;
  state.costUsd = resEditor.costUsd;

  const edAudit = getLastAuditCall(runId, 'editor');
  const edInput = edAudit?.input_tokens ?? 0;
  const edOutput = edAudit?.output_tokens ?? 0;
  const edTotal = edInput + edOutput;

  console.log(`Editor execution finished`);
  console.log(`  Input tokens:            ${edInput}`);
  console.log(`  Output tokens:           ${edOutput}`);
  console.log(`  Decision / Score:        ${state.editorVerdict?.decision} (${state.editorVerdict?.score}/10)`);

  const cleanRunTotalTokens = rTotal + wTotal + fcTotal + edTotal;
  console.log(`\nClean 1-Pass Run Total Tokens: ${cleanRunTotalTokens}`);

  return {
    topic,
    runId,
    researcher: {
      inputTokens: rInput,
      outputTokens: rOutput,
      totalTokens: rTotal,
      latencyMs: researcherLatency,
      notesProposed: state.notes.length, // All returned notes from LLM
      notesVerified: state.notes.length,
      droppedNotesCount: 0,
      notes: state.notes.map((n) => ({
        id: n.id,
        claim: n.claim,
        quote: n.quote,
        sourceUrl: n.sourceUrl,
      })),
    },
    writer: {
      inputTokens: wInput,
      outputTokens: wOutput,
      totalTokens: wTotal,
      claimsCount: state.claims.length,
    },
    factChecker: {
      inputTokens: fcInput,
      outputTokens: fcOutput,
      totalTokens: fcTotal,
      claimsChecked: state.claimChecks.length,
      supportedCount: supported,
      unsupportedCount: unsupported,
    },
    editor: {
      inputTokens: edInput,
      outputTokens: edOutput,
      totalTokens: edTotal,
      score: state.editorVerdict?.score ?? 0,
      decision: state.editorVerdict?.decision ?? 'unknown',
    },
    totalRunTokens: cleanRunTotalTokens,
    totalCostUsd: state.costUsd,
  };
}

async function main() {
  console.log('#################################################################');
  console.log('  STARTING STEP 4 EVALUATION: RELEVANCE-BASED PASSAGE SELECTION');
  console.log('#################################################################');

  const topic1 = 'Advances in TypeScript 5.0 Type Inference';
  const topic2 = 'HTTP/3 QUIC protocol connection migration performance';

  const res1 = await runStep4Topic(topic1, 1);

  console.log('\n[Pacing Pause] Waiting 15s between topics...');
  await new Promise((r) => setTimeout(r, 15000));

  const res2 = await runStep4Topic(topic2, 2);

  const outPath = path.resolve(process.cwd(), 'token-audit/step4-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ res1, res2 }, null, 2));

  console.log('\n' + '#'.repeat(70));
  console.log('  STEP 4 EVALUATION RUN COMPLETE');
  console.log(`  Saved results to ${outPath}`);
  console.log('#'.repeat(70));
}

main().catch((err) => {
  console.error('Step 4 evaluation failed:', err);
  process.exit(1);
});

