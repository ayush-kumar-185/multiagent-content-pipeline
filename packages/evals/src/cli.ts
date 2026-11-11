import 'dotenv/config';
import { hasConfiguredLLM } from '@citewriter/core';
import { runEvalSuite } from './runner.js';

async function main() {
  const args = process.argv.slice(2);
  const isStub = args.includes('--stub') || !hasConfiguredLLM();
  const topicsArg = args.find((a) => a.startsWith('--topics='));
  const topicIds = topicsArg ? topicsArg.replace('--topics=', '').split(',') : undefined;

  console.log('='.repeat(60));
  console.log('  CiteWriter Evaluation Runner');
  console.log(`  Execution Mode: ${isStub ? 'STUB (deterministic reproducible)' : 'LIVE LLM'}`);
  if (topicIds) {
    console.log(`  Selected Topics: ${topicIds.join(', ')}`);
  }
  console.log('='.repeat(60));

  const start = Date.now();
  const summary = await runEvalSuite({
    stub: isStub,
    topicIds,
  });

  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nCompleted evaluation of ${summary.totalTopics} topics in ${duration}s.`);
  console.log('\n--- Aggregate Metric Summary ---');
  console.log(
    `Baseline A: Unsupported Rate = ${summary.averages.baseline_a.avgUnsupportedClaimRate}%, Citation Coverage = ${summary.averages.baseline_a.avgCitationCoverage}%`,
  );
  console.log(
    `Baseline B: Unsupported Rate = ${summary.averages.baseline_b.avgUnsupportedClaimRate}%, Citation Coverage = ${summary.averages.baseline_b.avgCitationCoverage}%`,
  );
  console.log(
    `CiteWriter: Unsupported Rate = ${summary.averages.citewriter_pipeline.avgUnsupportedClaimRate}%, Citation Coverage = ${summary.averages.citewriter_pipeline.avgCitationCoverage}%`,
  );
  console.log('\nSaved raw results to: packages/evals/results/eval-results.json');
  console.log('Generated report at:  packages/evals/REPORT.md\n');
}

main().catch((err) => {
  console.error('Eval runner error:', err);
  process.exit(1);
});
