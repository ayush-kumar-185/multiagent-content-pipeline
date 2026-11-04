'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { getRun, cancelRun } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RunRecord } from '@/lib/types';
import { AgentProgressStream } from '@/components/AgentProgressStream';
import { ClaimHighlightArticle } from '@/components/ClaimHighlightArticle';
import { HumanReviewActions } from '@/components/HumanReviewActions';
import { ObservabilityBreakdown } from '@/components/ObservabilityBreakdown';
import {
  ArrowLeft,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const runId = resolvedParams.id;
  const { user } = useAuth();

  const [run, setRun] = useState<RunRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchRun = useCallback(async () => {
    try {
      const data = await getRun(runId, user.id);
      setRun(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch run');
    } finally {
      setIsLoading(false);
    }
  }, [runId, user.id]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  const handleCopyMarkdown = () => {
    if (run?.draft) {
      navigator.clipboard.writeText(run.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCancelRun = async () => {
    if (confirm('Are you sure you want to cancel this run?')) {
      try {
        await cancelRun(runId, user.id);
        await fetchRun();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Cancellation failed');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center space-y-3">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
        <p className="text-sm text-neutral-500">Loading run details...</p>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="py-16 text-center max-w-md mx-auto space-y-4">
        <XCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold">Failed to load run</h2>
        <p className="text-xs text-neutral-500">{error || 'Run not found'}</p>
        <Link
          href="/"
          className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition text-neutral-600 dark:text-neutral-300"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="font-mono text-xs text-neutral-400 font-medium">{run.id}</span>
              <span className="text-neutral-300 dark:text-neutral-700">•</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                {run.config.format === 'linkedin_post'
                  ? 'LinkedIn Post'
                  : run.config.format === 'twitter_thread'
                    ? 'X / Twitter Thread'
                    : 'Technical Article'}
              </span>
              <span className="text-neutral-300 dark:text-neutral-700">•</span>
              <span className="text-xs text-neutral-500">
                Created {new Date(run.createdAt).toLocaleDateString()}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight">
              {run.topic}
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-center">
          {run.draft && (
            <button
              onClick={handleCopyMarkdown}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-medium transition"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>
                {copied
                  ? 'Copied'
                  : run.config.format === 'twitter_thread'
                    ? 'Copy Thread'
                    : run.config.format === 'linkedin_post'
                      ? 'Copy Post'
                      : 'Copy Draft'}
              </span>
            </button>
          )}

          {['pending', 'running'].includes(run.status) && (
            <button
              onClick={handleCancelRun}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-medium transition"
            >
              <span>Cancel Run</span>
            </button>
          )}

          <button
            onClick={fetchRun}
            className="p-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 transition"
            title="Refresh State"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics & Parameters Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs shadow-sm">
          <div className="text-[10px] uppercase font-bold text-neutral-400">Status</div>
          <div className="font-bold capitalize text-neutral-900 dark:text-neutral-100 mt-1">
            {run.status.replace('_', ' ')}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs shadow-sm">
          <div className="text-[10px] uppercase font-bold text-neutral-400">Tokens / Cost</div>
          <div className="font-bold text-neutral-900 dark:text-neutral-100 mt-1 flex items-center space-x-1">
            <Cpu className="w-3.5 h-3.5 text-blue-500" />
            <span>{run.tokensUsed.toLocaleString()}</span>
            <span className="text-neutral-400">/</span>
            <span className="text-amber-600">${run.costUsd.toFixed(4)}</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs shadow-sm">
          <div className="text-[10px] uppercase font-bold text-neutral-400">Cycles & Citations</div>
          <div className="font-bold text-neutral-900 dark:text-neutral-100 mt-1">
            {run.writeCycles} write cycle{run.writeCycles === 1 ? '' : 's'} • {run.notes.length}{' '}
            notes
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs shadow-sm">
          <div className="text-[10px] uppercase font-bold text-neutral-400">Audience & Tone</div>
          <div className="font-medium text-neutral-700 dark:text-neutral-300 mt-1 truncate">
            {run.config.audience} ({run.config.targetWords}w)
          </div>
        </div>
      </div>

      {/* Observability & Per-Agent Cost Breakdown */}
      <ObservabilityBreakdown run={run} />

      {/* Main Content Area based on Status */}
      {/* 1. Live SSE Progress Stream (shown when running or pending) */}
      {['pending', 'running'].includes(run.status) && (
        <AgentProgressStream run={run} onRefreshRun={fetchRun} />
      )}

      {/* 2. Review Screen (shown when awaiting_review) */}
      {run.status === 'awaiting_review' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200 flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>
              All 4 agents have completed their automated loops. Click any highlighted claim in the article draft below to inspect verified sources, then approve or edit.
            </span>
          </div>

          {/* Interactive Article Draft with sentence-level claim verification */}
          <ClaimHighlightArticle
            draft={run.draft}
            claims={run.claims}
            claimChecks={run.claimChecks}
            notes={run.notes}
          />

          {/* Editor Agent Verdict & Human Review Decisions */}
          <HumanReviewActions
            runId={run.id}
            initialDraft={run.draft}
            editorVerdict={run.editorVerdict}
            openIssues={run.openIssues}
            onActionComplete={fetchRun}
          />
        </div>
      )}

      {/* 3. Approved Final Article */}
      {run.status === 'approved' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-900 dark:text-emerald-200 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">
              Article Approved & Verified! Every factual sentence has been audited against its
              source.
            </span>
          </div>

          <ClaimHighlightArticle
            draft={run.draft}
            claims={run.claims}
            claimChecks={run.claimChecks}
            notes={run.notes}
          />
        </div>
      )}

      {/* 4. Terminal Non-Approved States */}
      {['rejected', 'failed', 'budget_exceeded'].includes(run.status) && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold uppercase tracking-wider">
                Run Status: {run.status.replace('_', ' ')}
              </div>
              {run.openIssues.length > 0 && (
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  {run.openIssues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {run.draft && (
            <ClaimHighlightArticle
              draft={run.draft}
              claims={run.claims}
              claimChecks={run.claimChecks}
              notes={run.notes}
            />
          )}
        </div>
      )}
    </div>
  );
}
