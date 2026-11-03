import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllTopics } from './loader.js';
import {
  runBaselineA,
  runBaselineB,
  runCiteWriterPipeline,
  EvalExecutionOptions,
} from './baselines.js';
import { Topic, TopicEvalComparison, EvalSuiteSummary, VariantEvalResult } from './types.js';
import { generateMarkdownReport } from './reportGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RESULTS_PATH = path.resolve(__dirname, '../results/eval-results.json');
const DEFAULT_REPORT_PATH = path.resolve(__dirname, '../REPORT.md');

export interface RunnerOptions extends EvalExecutionOptions {
  topicIds?: string[];
  topicsDir?: string;
  resultsPath?: string;
  reportPath?: string;
}

export function computeVariantAverages(
  results: TopicEvalComparison[],
  variantKey: 'baselineA' | 'baselineB' | 'pipeline',
  label: string,
) {
  const n = results.length;
  if (n === 0) {
    return {
      label,
      avgUnsupportedClaimRate: 0,
      avgCitationCoverage: 0,
      avgRevisionCycles: 0,
      avgCostUsd: 0,
      avgTokens: 0,
      avgLatencyMs: 0,
    };
  }

  let totalUnsupp = 0;
  let totalCov = 0;
  let totalRev = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let totalLatency = 0;

  for (const item of results) {
    const v: VariantEvalResult = item[variantKey];
    totalUnsupp += v.metrics.unsupportedClaimRate;
    totalCov += v.metrics.citationCoverage;
    totalRev += v.metrics.revisionCycles;
    totalCost += v.metrics.costUsd;
    totalTokens += v.metrics.tokensUsed;
    totalLatency += v.metrics.latencyMs;
  }

  return {
    label,
    avgUnsupportedClaimRate: Math.round((totalUnsupp / n) * 10) / 10,
    avgCitationCoverage: Math.round((totalCov / n) * 10) / 10,
    avgRevisionCycles: Math.round((totalRev / n) * 10) / 10,
    avgCostUsd: Math.round((totalCost / n) * 100000) / 100000,
    avgTokens: Math.round(totalTokens / n),
    avgLatencyMs: Math.round(totalLatency / n),
  };
}

/**
 * Runs evaluation suite across topics and variants.
 */
export async function runEvalSuite(options: RunnerOptions = {}): Promise<EvalSuiteSummary> {
  const allTopics = await loadAllTopics(options.topicsDir);

  const topicsToRun: Topic[] = options.topicIds
    ? allTopics.filter((t) => options.topicIds?.includes(t.id))
    : allTopics;

  if (topicsToRun.length === 0) {
    throw new Error('No topics found matching evaluation criteria.');
  }

  const comparisonResults: TopicEvalComparison[] = [];

  for (const topic of topicsToRun) {
    // 1. Baseline A
    const baselineA = await runBaselineA(topic, options);

    // Notes for grounded variants (Baseline B and Pipeline)
    const notes = topic.mockNotes ?? [
      {
        id: 'n1',
        claim: topic.title,
        sourceUrl: 'https://example.com/source',
        quote: topic.prompt,
        retrievedAt: new Date().toISOString(),
      },
    ];

    // 2. Baseline B
    const baselineB = await runBaselineB(topic, notes, options);

    // 3. CiteWriter Pipeline
    const pipeline = await runCiteWriterPipeline(topic, notes, options);

    comparisonResults.push({
      topicId: topic.id,
      topicTitle: topic.title,
      category: topic.category,
      baselineA,
      baselineB,
      pipeline,
    });
  }

  const summary: EvalSuiteSummary = {
    timestamp: new Date().toISOString(),
    totalTopics: comparisonResults.length,
    averages: {
      baseline_a: computeVariantAverages(
        comparisonResults,
        'baselineA',
        'Baseline A (Zero-Shot Single-Prompt)',
      ),
      baseline_b: computeVariantAverages(
        comparisonResults,
        'baselineB',
        'Baseline B (Single-Prompt + Retrieved Notes)',
      ),
      citewriter_pipeline: computeVariantAverages(
        comparisonResults,
        'pipeline',
        'CiteWriter (Multi-Agent Pipeline)',
      ),
    },
    results: comparisonResults,
  };

  // Write raw results JSON
  const resultsPath = options.resultsPath ?? DEFAULT_RESULTS_PATH;
  await fs.mkdir(path.dirname(resultsPath), { recursive: true });
  await fs.writeFile(resultsPath, JSON.stringify(summary, null, 2), 'utf-8');

  // Generate & write Markdown report
  const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
  const markdown = generateMarkdownReport(summary);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, markdown, 'utf-8');

  return summary;
}
