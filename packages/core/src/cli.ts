import { Command } from '@langchain/langgraph';
import { createCiteWriterGraph } from './graph/builder.js';
import { GraphState } from './schemas/state.js';

async function runStubCLI() {
  const args = process.argv.slice(2);
  const topicArg = args[0] ?? 'Advances in TypeScript 5.0 Type Inference';
  const actionArg = (args[1] ?? 'approve').toLowerCase() as 'approve' | 'edit' | 'reject';

  console.log('='.repeat(70));
  console.log('  CiteWriter Stub Multi-Agent Pipeline CLI');
  console.log('='.repeat(70));
  console.log(`Topic: "${topicArg}"`);
  console.log(`Simulated Human Action on Review: "${actionArg}"`);
  console.log('-'.repeat(70));

  const runId = `cli-run-${Date.now()}`;
  const threadConfig = { configurable: { thread_id: runId } };
  const graph = createCiteWriterGraph();

  console.log(
    '\n[1/5] Launching pipeline (START -> researcher -> writer -> factChecker -> editor -> humanReview)...',
  );

  // Invoke initial pipeline
  await graph.invoke(
    {
      runId,
      topic: topicArg,
      config: {
        audience: 'software engineers',
        tone: 'technical and precise',
        targetWords: 600,
      },
    },
    threadConfig,
  );

  // Check state at interrupt
  const snapshot = await graph.getState(threadConfig);
  const state = snapshot.values as GraphState;

  console.log('\n----------------- Agent Output Summaries -----------------');
  console.log(`\n[Researcher] (Round ${state.researchRounds})`);
  console.log(`Collected ${state.notes.length} verified notes:`);
  state.notes.forEach((note) => {
    console.log(`  - [${note.id}] ${note.claim}`);
    console.log(`    Source: ${note.sourceUrl}`);
    console.log(`    Quote: "${note.quote}"`);
  });

  console.log(`\n[Writer] (Cycle ${state.writeCycles})`);
  console.log(`Generated draft with ${state.claims.length} claims:\n`);
  console.log(state.draft);

  console.log(`\n[Fact-Checker] Checked ${state.claimChecks.length} claims:`);
  state.claimChecks.forEach((check) => {
    const badge = check.status === 'supported' ? '[SUPPORTED]' : `[${check.status.toUpperCase()}]`;
    console.log(`  - ${badge} "${check.claim}" -> Cited: [${check.noteIds.join(', ')}]`);
    console.log(`    Reason: ${check.reason}`);
  });

  if (state.editorVerdict) {
    console.log(
      `\n[Editor] Verdict: ${state.editorVerdict.decision.toUpperCase()} (Score: ${state.editorVerdict.score}/10)`,
    );
    console.log(`  Feedback: "${state.editorVerdict.feedback}"`);
  }

  console.log('\n------------------ Human Review Pause -------------------');
  console.log(`Status: ${state.status.toUpperCase()}`);
  console.log(`Next Node: ${JSON.stringify(snapshot.next)}`);
  if (state.openIssues.length > 0) {
    console.log('Open Issues flagged for human:');
    state.openIssues.forEach((issue) => console.log(`  ! ${issue}`));
  } else {
    console.log('No open issues flagged. All claims supported.');
  }

  console.log(
    `\nTokens used so far: ${state.tokensUsed} | Estimated Cost: $${state.costUsd.toFixed(4)}`,
  );
  console.log('\n[2/5] Resuming graph from checkpoint with human action...');

  let resumePayload;
  if (actionArg === 'edit') {
    resumePayload = {
      action: 'edit' as const,
      editedDraft: `${state.draft}\n\n[Human Editor Note: Approved with manual polish.]`,
    };
  } else if (actionArg === 'reject') {
    resumePayload = {
      action: 'reject' as const,
      feedback: 'Rejected during CLI review.',
    };
  } else {
    resumePayload = { action: 'approve' as const };
  }

  const finalState = (await graph.invoke(
    new Command({ resume: resumePayload }),
    threadConfig,
  )) as GraphState;

  console.log('\n================ Pipeline Final Execution Result ================');
  console.log(`Final Status: ${finalState.status.toUpperCase()}`);
  console.log(`Human Action: ${finalState.humanAction?.action}`);
  console.log(`Total Research Rounds: ${finalState.researchRounds}`);
  console.log(`Total Write Cycles: ${finalState.writeCycles}`);
  console.log(
    `Total Tokens: ${finalState.tokensUsed} | Total Cost: $${finalState.costUsd.toFixed(4)}`,
  );
  console.log('=================================================================\n');
}

runStubCLI().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
