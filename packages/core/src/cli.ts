import dotenv from 'dotenv';
import { Command } from '@langchain/langgraph';
import { createCiteWriterGraph } from './graph/builder.js';
import { GraphState } from './schemas/state.js';
import { Note } from './schemas/note.js';
import { runDeterministicEditorChecks } from './agents/editor/deterministicChecks.js';
import { runDeterministicFactPreChecks } from './agents/factChecker/deterministicPreChecks.js';

// Load environment variables (.env)
dotenv.config();

const handWrittenNotes: Note[] = [
  {
    id: 'n1',
    claim:
      'TypeScript 5.0 introduced const type parameters, enabling developers to retain literal type inferences without explicit "as const" assertions.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote:
      'TypeScript 5.0 introduces const type parameters, which let you add a const modifier to a type parameter declaration to cause const-like inference to be the default.',
    retrievedAt: new Date().toISOString(),
  },
  {
    id: 'n2',
    claim:
      'TypeScript 5.0 aligned its decorator implementation with the official ECMAScript Stage 3 standard proposal.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote:
      'In TypeScript 5.0, decorators are now standardized to match the Stage 3 ECMAScript proposal.',
    retrievedAt: new Date().toISOString(),
  },
  {
    id: 'n3',
    claim:
      'Internal compiler optimizations and data structure refinements in TypeScript 5.0 reduced the installed package size by approximately 37%.',
    sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
    quote:
      'Between our changes to data structures, algorithms, and our architecture, we saw significant speedups, and the package size on disk dropped by 37%.',
    retrievedAt: new Date().toISOString(),
  },
];

async function runCLI() {
  const args = process.argv.slice(2);
  const topicArg = args[0] ?? 'Advances in TypeScript 5.0 Type Inference';
  const actionArg = (args[1] ?? 'approve').toLowerCase() as 'approve' | 'edit' | 'reject';

  const hasApiKey = Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);
  const hasSearchKey = Boolean(process.env.TAVILY_API_KEY || process.env.BRAVE_SEARCH_API_KEY);
  const providerName = process.env.OPENROUTER_API_KEY ? 'OpenRouter' : 'OpenAI';
  const useRealResearcher = hasApiKey && hasSearchKey;

  console.log('='.repeat(70));
  console.log('  CiteWriter Multi-Agent Pipeline CLI');
  console.log('='.repeat(70));
  console.log(`Topic: "${topicArg}"`);
  console.log(
    `Mode: ${hasApiKey ? `Real LLM (${providerName})` : 'Offline Deterministic Stub Mode'}${useRealResearcher ? ' + Live Web Search' : ' + Curated Primary Notes'}`,
  );
  console.log(`Simulated Human Action on Review: "${actionArg}"`);
  console.log('-'.repeat(70));

  const runId = `cli-run-${Date.now()}`;
  const threadConfig = { configurable: { thread_id: runId } };

  const graph = createCiteWriterGraph({
    useRealResearcher,
    useRealWriter: hasApiKey,
    useRealFactChecker: hasApiKey,
    useRealEditor: hasApiKey,
    fakeAgentOptions: {
      researcherBehavior: () => handWrittenNotes,
      factCheckerBehavior: (claims, notes) =>
        claims.map((c) => {
          const preCheck = runDeterministicFactPreChecks(c, notes);
          if (!preCheck.passed && preCheck.claimCheck) {
            return preCheck.claimCheck;
          }
          return {
            claim: c.claim,
            noteIds: c.noteIds,
            status: 'supported' as const,
            reason: 'Verified against primary notes (deterministic pre-check passed).',
          };
        }),
    },
  });

  console.log(
    '\n[1/5] Launching pipeline (START -> researcher -> writer -> factChecker -> editor -> humanReview)...',
  );

  // Invoke initial pipeline
  await graph.invoke(
    {
      runId,
      topic: topicArg,
      notes: handWrittenNotes,
      config: {
        audience: 'software engineers',
        tone: 'technical and precise',
        targetWords: 400,
      },
    },
    threadConfig,
  );

  // Check state at interrupt
  const snapshot = await graph.getState(threadConfig);
  const state = snapshot.values as GraphState;

  console.log('\n----------------- Agent Output Summaries -----------------');
  console.log(`\n[Researcher] (Round ${state.researchRounds})`);
  console.log(`Provided ${state.notes.length} verified notes:`);
  state.notes.forEach((note) => {
    console.log(`  - [${note.id}] ${note.claim}`);
    console.log(`    Source: ${note.sourceUrl}`);
  });

  console.log(`\n[Writer] (Cycle ${state.writeCycles})`);
  console.log(`Generated draft with ${state.claims.length} cited claims:\n`);
  console.log(state.draft);

  console.log(`\n[Fact-Checker] Verified ${state.claimChecks.length} claims:`);
  state.claimChecks.forEach((check) => {
    const badge = check.status === 'supported' ? '[SUPPORTED]' : `[${check.status.toUpperCase()}]`;
    console.log(`  - ${badge} "${check.claim}" -> Cited: [${check.noteIds.join(', ')}]`);
    console.log(`    Reason: ${check.reason}`);
  });

  // Run deterministic editor audit
  const audit = runDeterministicEditorChecks(state.draft, state.claims, state.config);
  console.log('\n[Deterministic Editorial Audit]');
  console.log(
    `  - Word Count: ${audit.wordCount} words (${audit.lengthPassed ? 'PASSED' : 'FLAGGED'})`,
  );
  console.log(
    `  - Readability: Flesch Score ${audit.fleschScore}/100, Grade Level ${audit.gradeLevel} (${audit.readingEaseLabel})`,
  );
  console.log(
    `  - Citation Density: ${audit.citedSentencesCount} citations (${Math.round(audit.citationCoverageRatio * 100)}% coverage, ${audit.citationPassed ? 'PASSED' : 'FLAGGED'})`,
  );

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
      editedDraft: `${state.draft}\n\n[Human Reviewer Note: Approved with manual polish.]`,
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

runCLI().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
