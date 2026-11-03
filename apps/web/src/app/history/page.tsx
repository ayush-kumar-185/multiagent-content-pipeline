'use client';

import React, { useEffect, useState } from 'react';
import { RunHistoryTable } from '@/components/RunHistoryTable';
import { listRuns } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RunRecord } from '@/lib/types';
import { History, CheckCircle2, Coins, Cpu, RefreshCw } from 'lucide-react';

export default function HistoryPage() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  const fetchRuns = async () => {
    setIsLoading(true);
    try {
      const data = await listRuns(user.id);
      setRuns(data);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [user.id]);

  const filteredRuns = runs.filter((r) => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  const totalTokens = runs.reduce((acc, r) => acc + (r.tokensUsed || 0), 0);
  const totalCost = runs.reduce((acc, r) => acc + (r.costUsd || 0), 0);
  const approvedCount = runs.filter((r) => r.status === 'approved').length;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 flex items-center space-x-2">
            <History className="w-6 h-6 text-blue-600" />
            <span>Authoring Run History</span>
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Historical trace of multi-agent runs, token usage, cost accounting, and approved
            articles
          </p>
        </div>

        <button
          onClick={fetchRuns}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-medium self-start sm:self-center transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Aggregate Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Total Runs
          </div>
          <div className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-100 mt-1">
            {runs.length}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Approved Articles
          </div>
          <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center space-x-1.5">
            <CheckCircle2 className="w-5 h-5" />
            <span>{approvedCount}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Tokens Processed
          </div>
          <div className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 mt-1 flex items-center space-x-1.5">
            <Cpu className="w-5 h-5" />
            <span>{totalTokens.toLocaleString()}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Total LLM Spend
          </div>
          <div className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-100 mt-1 flex items-center space-x-1.5">
            <Coins className="w-5 h-5 text-amber-500" />
            <span>${totalCost.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 border-b border-neutral-200 dark:border-neutral-800 pb-2 text-xs font-medium">
        {['all', 'approved', 'awaiting_review', 'running', 'rejected'].map((st) => (
          <button
            key={st}
            onClick={() => setFilter(st)}
            className={`px-3 py-1.5 rounded-lg capitalize transition ${
              filter === st
                ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-bold'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            {st.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Table */}
      <RunHistoryTable runs={filteredRuns} isLoading={isLoading} />
    </div>
  );
}
