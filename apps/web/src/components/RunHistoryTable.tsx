'use client';

import React from 'react';
import Link from 'next/link';
import { RunRecord } from '@/lib/types';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
  HelpCircle,
} from 'lucide-react';

interface RunHistoryTableProps {
  runs: RunRecord[];
  isLoading?: boolean;
}

export function RunHistoryTable({ runs, isLoading }: RunHistoryTableProps) {
  const getStatusBadge = (status: RunRecord['status']) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            <span>Approved</span>
          </span>
        );
      case 'awaiting_review':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 animate-pulse">
            <Clock className="w-3 h-3" />
            <span>Awaiting Review</span>
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Running</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300">
            <XCircle className="w-3 h-3" />
            <span>Rejected</span>
          </span>
        );
      case 'budget_exceeded':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertCircle className="w-3 h-3" />
            <span>Budget Exceeded</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            <XCircle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
            <HelpCircle className="w-3 h-3" />
            <span>Pending</span>
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-sm text-neutral-400 flex items-center justify-center space-x-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading run history...</span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-8 text-center border border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl">
        <Clock className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          No authoring runs recorded yet
        </h3>
        <p className="text-xs text-neutral-500 mt-1">
          Launch a new run using the form above to start writing verified articles.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
      <table className="w-full text-left text-xs">
        <thead className="bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-200 dark:border-neutral-800 uppercase tracking-wider text-neutral-500 font-semibold">
          <tr>
            <th className="py-3 px-4">Subject / Topic</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4">Tokens</th>
            <th className="py-3 px-4">Cost (USD)</th>
            <th className="py-3 px-4">Date</th>
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {runs.map((r) => (
            <tr
              key={r.id}
              className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition"
            >
              <td className="py-3 px-4 font-medium text-neutral-900 dark:text-neutral-100 max-w-xs truncate">
                <Link
                  href={`/runs/${r.id}`}
                  className="hover:text-blue-600 dark:hover:text-blue-400 transition"
                >
                  {r.topic}
                </Link>
                {r.sourceUrl && (
                  <div className="text-[10px] text-neutral-400 truncate mt-0.5">{r.sourceUrl}</div>
                )}
              </td>
              <td className="py-3 px-4">{getStatusBadge(r.status)}</td>
              <td className="py-3 px-4 font-mono text-neutral-600 dark:text-neutral-400">
                {r.tokensUsed?.toLocaleString() ?? 0}
              </td>
              <td className="py-3 px-4 font-mono text-neutral-600 dark:text-neutral-400">
                ${r.costUsd?.toFixed(4) ?? '0.0000'}
              </td>
              <td className="py-3 px-4 text-neutral-500 whitespace-nowrap">
                {new Date(r.createdAt).toLocaleDateString()}
              </td>
              <td className="py-3 px-4 text-right">
                <Link
                  href={`/runs/${r.id}`}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-medium text-neutral-800 dark:text-neutral-200 transition"
                >
                  <span>Open</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
