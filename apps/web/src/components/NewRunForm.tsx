'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRun } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Sparkles,
  Globe,
  Sliders,
  ArrowRight,
  Loader2,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';

export function NewRunForm() {
  const router = useRouter();
  const { user } = useAuth();

  const [topic, setTopic] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [audience, setAudience] = useState('software engineers and architects');
  const [tone, setTone] = useState('technical, precise, and practical');
  const [targetWords, setTargetWords] = useState(400);
  const [maxTokens, setMaxTokens] = useState(100000);
  const [maxCostUsd, setMaxCostUsd] = useState(1.5);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setError('Please enter a research topic or technical subject.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const newRun = await createRun(
        {
          topic: topic.trim(),
          sourceUrl: sourceUrl.trim() || undefined,
          config: {
            audience,
            tone,
            targetWords: Number(targetWords),
            maxTokens: Number(maxTokens),
            maxCostUsd: Number(maxCostUsd),
          },
        },
        user.id,
      );

      router.push(`/runs/${newRun.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch authoring run');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 flex items-center space-x-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          <span>Start Verified Authoring Run</span>
        </h2>
        <p className="text-sm text-neutral-500 mt-1">
          Four cooperating agents (Researcher, Writer, Fact-checker, Editor) will research, draft,
          verify, and polish your technical article with sentence-level citations.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-sm flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Topic Input */}
        <div>
          <label
            htmlFor="topic"
            className="block text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1.5"
          >
            Technical Subject or Question <span className="text-rose-500">*</span>
          </label>
          <input
            id="topic"
            type="text"
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. TypeScript 5.0 Type Parameters, PostgreSQL 16 Performance, Rust 2024 Closures"
            className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/50 focus:bg-white dark:focus:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-sm text-neutral-900 dark:text-neutral-100"
          />
        </div>

        {/* Source URL (Optional) */}
        <div>
          <label
            htmlFor="sourceUrl"
            className="block text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1.5 flex items-center space-x-1.5"
          >
            <Globe className="w-3.5 h-3.5 text-neutral-400" />
            <span>Seed Source URL (Optional)</span>
          </label>
          <input
            id="sourceUrl"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.com/blog/announcement"
            className="w-full px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/50 focus:bg-white dark:focus:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-sm text-neutral-900 dark:text-neutral-100"
          />
        </div>

        {/* Advanced Options Grid */}
        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center space-x-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
            <Sliders className="w-3.5 h-3.5" />
            <span>Editorial Parameters</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="audience"
                className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
              >
                Target Audience
              </label>
              <select
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="software engineers and architects">Software Engineers</option>
                <option value="engineering leadership and CTOs">Leadership & CTOs</option>
                <option value="computer science students">CS Students</option>
                <option value="general tech readers">General Tech Audience</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="tone"
                className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
              >
                Editorial Tone
              </label>
              <select
                id="tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="technical, precise, and practical">Technical & Precise</option>
                <option value="conversational, clear, and engaging">Conversational & Clear</option>
                <option value="formal, analytical, and rigorous">Formal & Rigorous</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label
                  htmlFor="targetWords"
                  className="block text-xs font-medium text-neutral-600 dark:text-neutral-400"
                >
                  Target Length
                </label>
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  {targetWords} words
                </span>
              </div>
              <input
                id="targetWords"
                type="range"
                min="150"
                max="1200"
                step="50"
                value={targetWords}
                onChange={(e) => setTargetWords(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Configurable Budget Guard & Observability */}
        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center space-x-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Configurable Budget Limits & Observability</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label
                  htmlFor="maxTokens"
                  className="block text-xs font-medium text-neutral-600 dark:text-neutral-400"
                >
                  Max Token Budget
                </label>
                <span className="text-[11px] font-mono text-neutral-500 font-medium">
                  {maxTokens.toLocaleString()} tokens
                </span>
              </div>
              <input
                id="maxTokens"
                type="number"
                min="10000"
                max="500000"
                step="5000"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[10px] text-neutral-400 mt-1">
                Halts run and transitions to review on breach
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label
                  htmlFor="maxCostUsd"
                  className="block text-xs font-medium text-neutral-600 dark:text-neutral-400"
                >
                  Max Cost Limit (USD)
                </label>
                <span className="text-[11px] font-mono text-neutral-500 font-medium">
                  ${maxCostUsd.toFixed(2)}
                </span>
              </div>
              <input
                id="maxCostUsd"
                type="number"
                min="0.10"
                max="10.00"
                step="0.10"
                value={maxCostUsd}
                onChange={(e) => setMaxCostUsd(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[10px] text-neutral-400 mt-1">Default $1.50 per run</p>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center space-x-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Launching Multi-Agent Pipeline...</span>
              </>
            ) : (
              <>
                <span>Launch Article Pipeline</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
