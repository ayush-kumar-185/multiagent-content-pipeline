import dotenv from 'dotenv';
dotenv.config();

process.env.TOKEN_AUDIT = '1';
process.env.MAX_RUN_TOKENS = '40000';
process.env.TARGET_WORDS = '500';
process.env.FACT_CHECKER_MAX_TOKENS = '2500';

import fs from 'fs';
import path from 'path';
import { createCiteWriterGraph } from '../packages/core/src/graph/builder.js';
import { loadDailyLedger } from '../packages/core/src/llm/ledger.js';
import { SearchProvider } from '../packages/core/src/tools/search/types.js';

interface AuditRecord {
  run_id: string;
  agent_name: string;
  model_id: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  finish_reason: string | null;
  latency_ms: number;
  attempt: number;
}

function getAuditCallsForRun(runId: string): AuditRecord[] {
  const auditPath = path.resolve(process.cwd(), 'token-audit/calls.jsonl');
  if (!fs.existsSync(auditPath)) return [];
  const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n').filter((l) => l.trim().length > 0);
  const results: AuditRecord[] = [];
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (rec.run_id === runId) {
        results.push(rec);
      }
    } catch {
      // ignore
    }
  }
  return results;
}

async function main() {
  console.log('================================================================');
  console.log('PART 2: REAL END-TO-END LANGGRAPH RUN (TOPIC 1 ONLY)');
  console.log('================================================================');

  // 1. Quota Pre-Check (must have > 25,000 remaining on every Groq model)
  const ledger = loadDailyLedger();
  const dateKey = new Date().toISOString().slice(0, 10);
  const groqModels = [
    { name: 'researcher', id: 'openai/gpt-oss-20b', limit: 200_000 },
    { name: 'writer', id: 'qwen/qwen3.8-27b', limit: 200_000 },
    { name: 'factChecker', id: 'openai/gpt-oss-120b', limit: 200_000 },
  ];

  console.log(`\n--- Quota Pre-Check (Date: ${dateKey}) ---`);
  for (const m of groqModels) {
    const used = ledger[dateKey]?.[m.id]?.totalTokens ?? 0;
    const remaining = m.limit - used;
    console.log(`Model ${m.id} (${m.name}): Used=${used}, Remaining=${remaining} (Limit=${m.limit})`);
    if (remaining < 25_000) {
      throw new Error(
        `ABORT: Groq model ${m.id} has only ${remaining} tokens remaining (< 25,000 limit threshold).`,
      );
    }
  }
  console.log('Quota pre-check passed: All Groq models have > 25,000 tokens remaining.\n');

  // 2. Load Cached Fetches
  const cachedPath = path.resolve(process.cwd(), 'token-audit/topic1-cached-pages.json');
  if (!fs.existsSync(cachedPath)) {
    throw new Error(`Cached pages not found at ${cachedPath}`);
  }
  const cachedPages: Array<{ url: string; title: string; rawText: string; wrappedText: string }> =
    JSON.parse(fs.readFileSync(cachedPath, 'utf8'));

  const cacheMap = new Map<string, string>();
  for (const p of cachedPages) {
    cacheMap.set(p.url, p.rawText);
  }

  const cachedSearchProvider: SearchProvider = {
    search: async (_query: string, _maxResults?: number) => {
      return cachedPages.map((p) => ({
        url: p.url,
        title: p.title,
        snippet: p.rawText.slice(0, 200),
      }));
    },
  };

  const cachedCustomFetch: typeof fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const text = cacheMap.get(urlStr);
    if (text) {
      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return fetch(input, init);
  };

  // 3. Compile LangGraph
  const app = createCiteWriterGraph({
    useRealResearcher: true,
    useRealWriter: true,
    useRealFactChecker: true,
    useRealEditor: true,
    searchProvider: cachedSearchProvider,
    fetchOptions: { customFetch: cachedCustomFetch },
  });

  const topic = 'Advances in TypeScript 5.0 Type Inference';
  const runId = `e2e-topic1-${Date.now()}`;
  const threadConfig = { configurable: { thread_id: runId } };

  console.log(`Run ID: ${runId}`);
  console.log(`Topic: "${topic}"`);
  console.log(`Target Words: ${process.env.TARGET_WORDS || 500}`);
  console.log(`Max Run Tokens: ${process.env.MAX_RUN_TOKENS || 40000}`);
  console.log(`Writer Reasoning Effort: ${process.env.WRITER_REASONING_EFFORT || 'none'}`);
  console.log(`Fact Checker Max Tokens: ${process.env.FACT_CHECKER_MAX_TOKENS || 2500}`);
  console.log(`Compiled LangGraph initialized. Starting stream...\n`);

  const wallTimeStart = Date.now();
  const nodeSequence: string[] = [];
  const factCheckPasses: Array<{
    pass: number;
    totalClaims: number;
    supported: number;
    unsupported: number;
    needsMore: number;
    sum: number;
    checks: any[];
  }> = [];

  const stream = await app.stream(
    {
      runId,
      topic,
      config: {
        audience: 'software engineers',
        tone: 'technical and precise',
        targetWords: 500,
        maxTokens: 40000,
      },
    },
    { ...threadConfig, streamMode: 'updates' },
  );

  for await (const chunk of stream) {
    const nodeNames = Object.keys(chunk);
    for (const nodeName of nodeNames) {
      nodeSequence.push(nodeName);
      const nodeOutput = (chunk as Record<string, any>)[nodeName];
      console.log(`\n>>> [Node Executed: ${nodeName}] at +${((Date.now() - wallTimeStart) / 1000).toFixed(1)}s`);

      if (nodeName === 'researcher') {
        console.log(`    Research Rounds: ${nodeOutput.researchRounds}`);
        console.log(`    Total Notes in State: ${nodeOutput.notes?.length}`);
      } else if (nodeName === 'writer') {
        console.log(`    Write Cycles: ${nodeOutput.writeCycles}`);
        console.log(`    Claims Drafted: ${nodeOutput.claims?.length}`);
        const words = nodeOutput.draft ? nodeOutput.draft.trim().split(/\s+/).length : 0;
        console.log(`    Draft Word Count: ${words} words`);
      } else if (nodeName === 'factChecker') {
        const claims = nodeOutput.claimChecks || [];
        const supported = claims.filter((c: any) => c.status === 'supported').length;
        const unsupported = claims.filter((c: any) => c.status === 'unsupported').length;
        const uncitedSentences = claims.filter((c: any) =>
          c.status === 'unsupported' &&
          (c.reason?.includes('Sentence has no citation marker') ||
            c.reason?.includes('does not end with a citation marker')),
        ).length;
        const needsMore = claims.filter((c: any) => c.status === 'needs_more_research').length;
        const sum = supported + unsupported + needsMore;
        const passNum = factCheckPasses.length + 1;
        console.log(`    Fact-Check Pass #${passNum}:`);
        console.log(`      Total Evaluated Claims/Sentences: ${claims.length}`);
        console.log(`      Supported: ${supported}`);
        console.log(`      Unsupported: ${unsupported} (Uncited sentences: ${uncitedSentences}, Factual/number flags: ${unsupported - uncitedSentences})`);
        console.log(`      Needs More Research: ${needsMore}`);
        console.log(`      Sum check: ${supported} (supported) + ${unsupported} (unsupported) + ${needsMore} (needsMore) = ${sum} === ${claims.length} (${sum === claims.length ? 'MATCH' : 'MISMATCH'})`);
        factCheckPasses.push({
          pass: passNum,
          totalClaims: claims.length,
          supported,
          unsupported,
          uncitedSentences,
          needsMore,
          sum,
          checks: claims,
        });
      } else if (nodeName === 'editor') {
        console.log(`    Editor Score: ${nodeOutput.editorVerdict?.score}/10`);
        console.log(`    Editor Decision: ${nodeOutput.editorVerdict?.decision}`);
        console.log(`    Editor Feedback: ${nodeOutput.editorVerdict?.feedback}`);
      } else if (nodeName === 'prepareReview') {
        console.log(`    Status: ${nodeOutput.status}`);
        console.log(`    Open Issues: ${nodeOutput.openIssues?.length ? JSON.stringify(nodeOutput.openIssues) : 'None'}`);
      }
    }
  }

  const wallTimeMs = Date.now() - wallTimeStart;
  const finalState = await app.getState(threadConfig);
  const values = finalState.values;

  console.log('\n================================================================');
  console.log('E2E RUN EXECUTION FINISHED');
  console.log('================================================================');
  console.log(`Wall Time: ${(wallTimeMs / 1000).toFixed(2)}s`);
  console.log(`Node Sequence: ${nodeSequence.join(' -> ')}`);
  console.log(`Research Rounds: ${values.researchRounds}`);
  console.log(`Write Cycles: ${values.writeCycles}`);
  console.log(`Next Node(s) in Graph: ${JSON.stringify(finalState.next)}`);
  console.log(`Final Status: ${values.status}`);

  // Notes Breakdown
  console.log('\n--- Notes Produced & Audited ---');
  console.log(`Total Notes Kept in State: ${values.notes.length}`);
  values.notes.forEach((n: any, idx: number) => {
    console.log(`  [Note ${n.id || `n${idx + 1}`}] Claim: "${n.claim.slice(0, 70)}..."`);
    console.log(`    Quote: "${n.quote}"`);
    console.log(`    Source: ${n.sourceUrl}`);
  });

  // Fact-Check Passes Summary
  console.log('\n--- Fact-Check Passes Summary ---');
  factCheckPasses.forEach((p) => {
    console.log(
      `Pass #${p.pass}: Total=${p.totalClaims}, Supported=${p.supported}, Unsupported=${p.unsupported} (Uncited=${p.uncitedSentences}, Factual=${p.unsupported - p.uncitedSentences}), NeedsMore=${p.needsMore} (Sum=${p.sum})`,
    );
  });

  // Final Claim Statuses
  const finalClaims = values.claimChecks || [];
  const finalSupported = finalClaims.filter((c: any) => c.status === 'supported');
  const finalUnsupported = finalClaims.filter((c: any) => c.status === 'unsupported');
  const finalUncited = finalClaims.filter(
    (c: any) =>
      c.status === 'unsupported' &&
      (c.reason?.includes('Sentence has no citation marker') ||
        c.reason?.includes('does not end with a citation marker')),
  );
  const finalNeedsMore = finalClaims.filter((c: any) => c.status === 'needs_more_research');
  console.log(`\nFinal Claim Statuses (Total: ${finalClaims.length}):`);
  console.log(`  Supported: ${finalSupported.length}`);
  console.log(
    `  Unsupported: ${finalUnsupported.length} (Uncited sentences: ${finalUncited.length}, Factual/number flags: ${finalUnsupported.length - finalUncited.length})`,
  );
  console.log(`  Needs More Research: ${finalNeedsMore.length}`);
  console.log(
    `  Sum: ${finalSupported.length + finalUnsupported.length + finalNeedsMore.length} === ${finalClaims.length}`,
  );

  // Unsupported Claims with Cited Quotes
  if (finalUnsupported.length > 0) {
    console.log('\n--- Unsupported Claims and Cited Quotes ---');
    finalUnsupported.forEach((c: any, i: number) => {
      console.log(`[Unsupported #${i + 1}] Claim: "${c.claim}"`);
      console.log(`  Status: ${c.status} | Reason: ${c.reason}`);
      console.log(`  Cited Notes: ${JSON.stringify(c.noteIds)}`);
      if (Array.isArray(c.noteIds)) {
        for (const nid of c.noteIds) {
          const noteObj = values.notes.find((n: any) => n.id === nid);
          if (noteObj) {
            console.log(`    Note [${nid}] Quote: "${noteObj.quote}"`);
          }
        }
      }
    });
  } else {
    console.log('\nAll claims supported! No unsupported claims.');
  }

  // Token Audit & Ledger Summary
  console.log('\n--- Token Audit for This Run ---');
  const auditCalls = getAuditCallsForRun(runId);
  const agentTokens: Record<string, { in: number; out: number; reasoning: number; total: number; calls: number }> = {};
  let runTotalIn = 0;
  let runTotalOut = 0;
  let runTotalReasoning = 0;

  for (const c of auditCalls) {
    const role = c.agent_name;
    if (!agentTokens[role]) {
      agentTokens[role] = { in: 0, out: 0, reasoning: 0, total: 0, calls: 0 };
    }
    agentTokens[role].in += c.input_tokens;
    agentTokens[role].out += c.output_tokens;
    agentTokens[role].reasoning += c.reasoning_tokens || 0;
    agentTokens[role].total += c.input_tokens + c.output_tokens;
    agentTokens[role].calls += 1;

    runTotalIn += c.input_tokens;
    runTotalOut += c.output_tokens;
    runTotalReasoning += c.reasoning_tokens || 0;
  }

  for (const [role, t] of Object.entries(agentTokens)) {
    console.log(`Agent "${role}": Calls=${t.calls}, In=${t.in}, Out=${t.out}, Reasoning=${t.reasoning}, Total=${t.total}`);
  }
  console.log(`Run Totals: In=${runTotalIn}, Out=${runTotalOut}, Reasoning=${runTotalReasoning}, Total=${runTotalIn + runTotalOut}`);
  console.log(`State tokensUsed: ${values.tokensUsed}, costUsd: $${values.costUsd}`);

  // Ledger Afterwards
  console.log('\n--- Daily Ledger Afterwards ---');
  const ledgerAfter = loadDailyLedger();
  const dayStats = ledgerAfter[dateKey] || {};
  for (const [model, stats] of Object.entries(dayStats)) {
    console.log(`Model "${model}": Calls=${stats.calls}, TotalTokens=${stats.totalTokens} (Prompt=${stats.promptTokens}, Completion=${stats.completionTokens})`);
  }

  // Print Final Draft
  console.log('\n================================================================');
  console.log('FINAL DRAFT');
  console.log('================================================================');
  console.log(values.draft);
  console.log('================================================================\n');

  // Save Run Artifact
  const artifactPath = path.resolve(process.cwd(), 'token-audit/topic1-e2e-result.json');
  fs.writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        runId,
        topic,
        wallTimeMs,
        nodeSequence,
        researchRounds: values.researchRounds,
        writeCycles: values.writeCycles,
        finalStatus: values.status,
        next: finalState.next,
        notes: values.notes,
        factCheckPasses,
        finalClaims,
        agentTokens,
        runTotals: { in: runTotalIn, out: runTotalOut, reasoning: runTotalReasoning, total: runTotalIn + runTotalOut },
        tokensUsed: values.tokensUsed,
        costUsd: values.costUsd,
        ledgerDayStats: dayStats,
        finalDraft: values.draft,
      },
      null,
      2,
    ),
  );
  console.log(`Saved detailed execution result to ${artifactPath}`);
}

main().catch((err) => {
  console.error('\n!!! ERROR IN E2E EXECUTION !!!');
  console.error(err);
  process.exit(1);
});

