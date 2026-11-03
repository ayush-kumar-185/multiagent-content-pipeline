'use client';

import React from 'react';
import { RunRecord } from '@/lib/types';
import { Activity, Cpu, DollarSign, Layers, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface ObservabilityBreakdownProps {
  run: RunRecord;
}

export function ObservabilityBreakdown({ run }: ObservabilityBreakdownProps) {
  const maxCost = run.config.maxCostUsd ?? 1.5;
  const maxTokens = run.config.maxTokens ?? 100000;

  const costPercentage = Math.min(100, Math.max(0, (run.costUsd / maxCost) * 100));
  const tokensPercentage = Math.min(100, Math.max(0, (run.tokensUsed / maxTokens) * 100));

  const metrics = run.agentMetrics ?? {};

  const agentDefinitions = [
    {
      id: 'researcher',
      label: 'Researcher',
      role: 'Web search, fetch & note synthesis',
      color:
        'border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300',
    },
    {
      id: 'writer',
      label: 'Writer',
      role: 'Draft synthesis & citation parsing',
      color:
        'border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-300',
    },
    {
      id: 'factChecker',
      label: 'Fact-Checker',
      role: 'Deterministic pre-checks & audit',
      color:
        'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300',
    },
    {
      id: 'editor',
      label: 'Editor',
      role: 'Rubric grading & polish review',
      color:
        'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300',
    },
  ];

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-4">
        <div>
          <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100 flex items-center space-x-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>Agent Cost & Observability Breakdown</span>
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Real-time token accounting, cost estimation, and Langfuse tracing telemetry across all 4
            agents.
          </p>
        </div>

        <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-[11px] font-semibold text-blue-700 dark:text-blue-300 self-start sm:self-center">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Budget Guard Active</span>
        </div>
      </div>

      {/* Budget Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cost Budget */}
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-800/40 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-neutral-600 dark:text-neutral-400 flex items-center space-x-1">
              <DollarSign className="w-3.5 h-3.5 text-amber-600" />
              <span>Cost Budget Usage</span>
            </span>
            <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100">
              ${run.costUsd.toFixed(4)} / ${maxCost.toFixed(2)}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                costPercentage > 85
                  ? 'bg-rose-500'
                  : costPercentage > 60
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.max(2, costPercentage)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[11px] text-neutral-400">
            <span>{costPercentage.toFixed(1)}% of cap</span>
            <span>Limit: ${maxCost.toFixed(2)} max</span>
          </div>
        </div>

        {/* Token Budget */}
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-800/40 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-neutral-600 dark:text-neutral-400 flex items-center space-x-1">
              <Cpu className="w-3.5 h-3.5 text-blue-500" />
              <span>Token Budget Usage</span>
            </span>
            <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100">
              {run.tokensUsed.toLocaleString()} / {maxTokens.toLocaleString()}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                tokensPercentage > 85
                  ? 'bg-rose-500'
                  : tokensPercentage > 60
                    ? 'bg-amber-500'
                    : 'bg-blue-500'
              }`}
              style={{ width: `${Math.max(2, tokensPercentage)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[11px] text-neutral-400">
            <span>{tokensPercentage.toFixed(1)}% of cap</span>
            <span>Limit: {maxTokens.toLocaleString()} tokens</span>
          </div>
        </div>
      </div>

      {/* Per-Agent Breakdown Cards */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3 flex items-center space-x-1.5">
          <Layers className="w-3.5 h-3.5" />
          <span>Per-Agent Resource Accounting</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {agentDefinitions.map((agent) => {
            const agentMetric = metrics[agent.id] ?? {
              tokensUsed: 0,
              costUsd: 0,
              calls: 0,
            };

            const shareOfCost =
              run.costUsd > 0 ? ((agentMetric.costUsd / run.costUsd) * 100).toFixed(0) : '0';

            return (
              <div
                key={agent.id}
                className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-800/30 flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                      {agent.label}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-200/60 dark:bg-neutral-700/60 text-neutral-600 dark:text-neutral-300">
                      {agentMetric.calls} call{agentMetric.calls === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-tight">{agent.role}</p>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-neutral-200/60 dark:border-neutral-700/60">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-500">Tokens</span>
                    <span className="font-mono font-semibold text-neutral-800 dark:text-neutral-200">
                      {agentMetric.tokensUsed.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-500">Cost</span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      ${agentMetric.costUsd.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-neutral-400">
                    <span>Cost Share</span>
                    <span>{shareOfCost}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Telemetry Trace Badge */}
      <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-neutral-500 gap-2">
        <div className="flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>
            Observability Trace ID:{' '}
            <span className="font-mono text-neutral-700 dark:text-neutral-300 font-semibold">
              {run.id}
            </span>
          </span>
        </div>
        <div className="text-[11px] text-neutral-400">
          Traces collected for LLM generations & web tool executions
        </div>
      </div>
    </div>
  );
}
