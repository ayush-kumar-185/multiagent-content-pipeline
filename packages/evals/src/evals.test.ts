import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import {
  loadAllTopics,
  loadTopicById,
  extractFactualSentences,
  calculateCitationCoverage,
  calculateClaimStats,
  computeRunMetrics,
  runBaselineA,
  runBaselineB,
  runCiteWriterPipeline,
  runEvalSuite,
} from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CiteWriter Evals & Baseline Suite', () => {
  describe('Topic Loading & Validation', () => {
    it('loads all 16 technical topics and validates schemas', async () => {
      const topics = await loadAllTopics();
      expect(topics.length).toBeGreaterThanOrEqual(15);
      expect(topics.length).toBe(16);

      for (const topic of topics) {
        expect(topic.id).toBeTruthy();
        expect(topic.title).toBeTruthy();
        expect(topic.category).toBeTruthy();
        expect(topic.prompt).toBeTruthy();
        expect(topic.rubric.mustInclude.length).toBeGreaterThanOrEqual(3);
        expect(topic.rubric.expectedCitations.length).toBeGreaterThanOrEqual(1);
        expect(topic.rubric.unsupportedClaimRisks.length).toBeGreaterThanOrEqual(1);
        expect(topic.mockNotes?.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('loads a specific topic by ID', async () => {
      const topic = await loadTopicById('distributed-raft-consensus');
      expect(topic.id).toBe('distributed-raft-consensus');
      expect(topic.category).toBe('Distributed Systems');
    });

    it('throws error for non-existent topic ID', async () => {
      await expect(loadTopicById('non-existent-topic-404')).rejects.toThrow(
        /Topic with id 'non-existent-topic-404' not found/,
      );
    });
  });

  describe('Automated Scoring Metrics', () => {
    it('extracts factual sentences while ignoring markdown headings', () => {
      const draft = `# Title
## Subheader
This is the first sentence. This is the second sentence!
---
Another sentence here.`;

      const sentences = extractFactualSentences(draft);
      expect(sentences).toEqual([
        'This is the first sentence.',
        'This is the second sentence!',
        'Another sentence here.',
      ]);
    });

    it('calculates citation coverage correctly', () => {
      const draft = `Sentence one with citation [n1].
Sentence two without citation.
Sentence three with multiple citations [n1, n2].`;

      const coverage = calculateCitationCoverage(draft);
      expect(coverage.totalSentences).toBe(3);
      expect(coverage.citedSentences).toBe(2);
      expect(coverage.coveragePercent).toBe(66.7);
    });

    it('calculates claim check statistics and unsupported claim rate', () => {
      const checks = [
        { claim: 'A', noteIds: ['n1'], status: 'supported' as const, reason: 'ok' },
        { claim: 'B', noteIds: ['n2'], status: 'supported' as const, reason: 'ok' },
        { claim: 'C', noteIds: ['n3'], status: 'unsupported' as const, reason: 'bad' },
        { claim: 'D', noteIds: ['n4'], status: 'needs_more_research' as const, reason: 'more' },
      ];

      const stats = calculateClaimStats(checks);
      expect(stats.totalClaims).toBe(4);
      expect(stats.supported).toBe(2);
      expect(stats.unsupported).toBe(1);
      expect(stats.needsResearch).toBe(1);
      expect(stats.unsupportedClaimRate).toBe(50.0);
    });

    it('computes composite run metrics with proper fallbacks', () => {
      const metrics = computeRunMetrics({
        draft: 'First sentence. Second sentence.',
        claimChecks: [],
        revisionCycles: 0,
        tokensUsed: 300,
        costUsd: 0.00045,
        latencyMs: 150,
      });

      // Draft has 0 citations, so all sentences are ungrounded (100% unsupported rate)
      expect(metrics.totalClaims).toBe(0);
      expect(metrics.citationCoverage).toBe(0);
      expect(metrics.unsupportedClaimRate).toBe(100.0);
      expect(metrics.revisionCycles).toBe(0);
    });
  });

  describe('Baselines & Pipeline Execution (Stub Mode)', () => {
    it('runs Baseline A zero-shot writer', async () => {
      const topic = await loadTopicById('rust-borrow-checker');
      const result = await runBaselineA(topic, { stub: true });

      expect(result.variant).toBe('baseline_a');
      expect(result.metrics.revisionCycles).toBe(0);
      expect(result.metrics.citationCoverage).toBe(0);
      expect(result.metrics.unsupportedClaimRate).toBe(100);
      expect(result.notes.length).toBe(0);
    });

    it('runs Baseline B single-prompt writer with retrieved notes', async () => {
      const topic = await loadTopicById('postgres-mvcc-wal');
      const result = await runBaselineB(topic, topic.mockNotes ?? [], { stub: true });

      expect(result.variant).toBe('baseline_b');
      expect(result.notes.length).toBeGreaterThan(0);
      expect(result.metrics.citationCoverage).toBeGreaterThan(0);
      expect(result.metrics.revisionCycles).toBe(0);
      // Contains the injected hallucinated claim, so unsupported claims > 0
      expect(result.claimChecksSummary.unsupported).toBeGreaterThan(0);
    });

    it('runs CiteWriter multi-agent pipeline with iterative verification', async () => {
      const topic = await loadTopicById('distributed-raft-consensus');
      const result = await runCiteWriterPipeline(topic, topic.mockNotes ?? [], { stub: true });

      expect(result.variant).toBe('citewriter_pipeline');
      expect(result.metrics.citationCoverage).toBe(100);
      expect(result.metrics.unsupportedClaimRate).toBe(0);
      expect(result.metrics.revisionCycles).toBe(1);
      expect(result.claimChecksSummary.unsupported).toBe(0);
    });
  });

  describe('Full Eval Runner & Report Generation', () => {
    it('executes eval runner and writes results JSON and REPORT.md', async () => {
      const tempResultsPath = path.resolve(__dirname, '../results/test-results.json');
      const tempReportPath = path.resolve(__dirname, '../test-REPORT.md');

      const summary = await runEvalSuite({
        stub: true,
        topicIds: ['distributed-raft-consensus', 'postgres-mvcc-wal'],
        resultsPath: tempResultsPath,
        reportPath: tempReportPath,
      });

      expect(summary.totalTopics).toBe(2);
      expect(summary.averages.baseline_a.avgUnsupportedClaimRate).toBe(100);
      expect(summary.averages.citewriter_pipeline.avgUnsupportedClaimRate).toBe(0);
      expect(summary.averages.citewriter_pipeline.avgCitationCoverage).toBe(100);

      // Verify files were generated
      const resultsExist = await fs
        .access(tempResultsPath)
        .then(() => true)
        .catch(() => false);
      const reportExist = await fs
        .access(tempReportPath)
        .then(() => true)
        .catch(() => false);

      expect(resultsExist).toBe(true);
      expect(reportExist).toBe(true);

      const reportContent = await fs.readFile(tempReportPath, 'utf-8');
      expect(reportContent).toContain('# CiteWriter Evaluation Report');
      expect(reportContent).toContain('Manual Spot-Check Verification');
      expect(reportContent).toContain('Honest Limitations & Failure Modes');

      // Cleanup temp test files
      await fs.unlink(tempResultsPath).catch(() => {});
      await fs.unlink(tempReportPath).catch(() => {});
    });
  });
});
