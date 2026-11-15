import dotenv from 'dotenv';
dotenv.config();

process.env.TOKEN_AUDIT = '1';

import { Command } from '@langchain/langgraph';
import { createCiteWriterGraph } from '../packages/core/src/graph/builder.js';
import { GraphState } from '../packages/core/src/schemas/state.js';
import { getAgentModel, getAgentProvider } from '../packages/core/src/llm/client.js';

interface TopicRunResult {
  topic: string;
  runId: string;
  notesCount: number;
  claimsCount: number;
  checksCount: number;
  editorDecision?: string;
  editorScore?: number;
  finalStatus: string;
  totalTokens: number;
  totalCostUsd: number;
  agentTokens: Record<string, number>;
}

async function runTopicPipeline(topic: string, index: number): Promise<TopicRunResult> {
  console.log('\n' + '='.repeat(70));
  console.log(`[Run ${index}] Executing Full Pipeline on Topic: "${topic}"`);
  console.log('='.repeat(70));

  const runId = `audit-run-${index}-${Date.now()}`;
  const threadConfig = { configurable: { thread_id: runId } };

  console.log('Agent Model Assignments:');
  console.log(`  Researcher:   ${getAgentProvider('researcher')} / ${getAgentModel('researcher')}`);
  console.log(`  Writer:       ${getAgentProvider('writer')} / ${getAgentModel('writer')}`);
  console.log(`  Fact-Checker: ${getAgentProvider('factChecker')} / ${getAgentModel('factChecker')}`);
  console.log(`  Editor:       ${getAgentProvider('editor')} / ${getAgentModel('editor')}`);

  const graph = createCiteWriterGraph({
    useRealResearcher: true,
    useRealWriter: true,
    useRealFactChecker: true,
    useRealEditor: true,
  });

  console.log('\n[Phase 1] Invoking pipeline through agents...');
  const startMs = Date.now();

  try {
    await graph.invoke(
      {
        runId,
        topic,
        notes: [], // Real researcher will gather live notes from the web
        config: {
          audience: 'software engineers',
          tone: 'technical and precise',
          targetWords: 350,
        },
      },
      threadConfig,
    );
  } catch (err) {
    console.error(`[Run ${index}] Error during initial graph invocation:`, err);
  }

  const snapshot = await graph.getState(threadConfig);
  const state = snapshot.values as GraphState;

  console.log(`[Phase 2] Pipeline reached pause state: ${state.status}`);
  console.log(`  Research rounds: ${state.researchRounds}, Verified Notes: ${state.notes.length}`);
  console.log(`  Write cycles: ${state.writeCycles}, Draft claims: ${state.claims.length}`);
  console.log(`  Claim checks: ${state.claimChecks.length}`);
  if (state.editorVerdict) {
    console.log(`  Editor verdict: ${state.editorVerdict.decision} (score: ${state.editorVerdict.score}/10)`);
    console.log(`  Editor feedback: "${state.editorVerdict.feedback.slice(0, 120)}..."`);
  }

  // Resume from human review
  console.log('\n[Phase 3] Resuming from Human Review (Action: approve)...');
  let finalState: GraphState;
  try {
    finalState = (await graph.invoke(
      new Command({ resume: { action: 'approve' } }),
      threadConfig,
    )) as GraphState;
  } catch (err) {
    console.warn(`[Run ${index}] Resume invocation note/error:`, err);
    finalState = state;
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[Run ${index}] Completed in ${elapsedSec}s with final status: ${finalState.status}`);
  console.log(`  Total Tokens Recorded by State: ${finalState.tokensUsed}`);
  console.log(`  Total Cost Recorded by State: $${finalState.costUsd.toFixed(4)}`);

  const agentTokens: Record<string, number> = {
    researcher: finalState.agentMetrics?.researcher?.tokensUsed ?? 0,
    writer: finalState.agentMetrics?.writer?.tokensUsed ?? 0,
    factChecker: finalState.agentMetrics?.factChecker?.tokensUsed ?? 0,
    editor: finalState.agentMetrics?.editor?.tokensUsed ?? 0,
  };

  return {
    topic,
    runId,
    notesCount: finalState.notes.length,
    claimsCount: finalState.claims.length,
    checksCount: finalState.claimChecks.length,
    editorDecision: finalState.editorVerdict?.decision,
    editorScore: finalState.editorVerdict?.score,
    finalStatus: finalState.status,
    totalTokens: finalState.tokensUsed,
    totalCostUsd: finalState.costUsd,
    agentTokens,
  };
}

async function main() {
  console.log('#################################################################');
  console.log('  STARTING PHASE E: MEASURED PIPELINE AUDIT ON 2 REAL TOPICS');
  console.log('#################################################################');

  const topic1 = 'Advances in TypeScript 5.0 Type Inference';
  const topic2 = 'HTTP/3 QUIC protocol connection migration performance';

  const res1 = await runTopicPipeline(topic1, 1);

  // Brief pause between runs to let Groq TPM bucket drain
  console.log('\n[Pacing Pause] Waiting 15s between topic runs to drain token buckets...');
  await new Promise((r) => setTimeout(r, 15000));

  const res2 = await runTopicPipeline(topic2, 2);

  console.log('\n' + '#'.repeat(70));
  console.log('  AUDIT EXECUTION COMPLETE');
  console.log('#'.repeat(70));
  console.log('Run 1 Summary:', res1);
  console.log('Run 2 Summary:', res2);
}

main().catch(console.error);

