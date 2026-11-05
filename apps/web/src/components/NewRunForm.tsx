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
  FileText,
  Share2,
  MessageSquare,
} from 'lucide-react';

export function NewRunForm() {
  const router = useRouter();
  const { user } = useAuth();

  const [format, setFormat] = useState<'article' | 'linkedin_post' | 'twitter_thread'>('article');
  const [topic, setTopic] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [audience, setAudience] = useState('software engineers and architects');
  const [tone, setTone] = useState('technical, precise, and practical');
  const [targetWords, setTargetWords] = useState(400);
  const [maxTokens, setMaxTokens] = useState(100000);
  const [maxCostUsd, setMaxCostUsd] = useState(1.5);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFormatSelect = (selectedFormat: 'article' | 'linkedin_post' | 'twitter_thread') => {
    setFormat(selectedFormat);
    if (selectedFormat === 'linkedin_post') {
      setTargetWords(200);
      setTone('engaging, insightful, and professional');
    } else if (selectedFormat === 'twitter_thread') {
      setTargetWords(250);
      setTone('punchy, technical, and compelling');
    } else {
      setTargetWords(400);
      setTone('technical, precise, and practical');
    }
  };

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
            format,
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
          verify, and polish your content with sentence-level citations.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-sm flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Content Format Selector */}
        <div>
          <label className="block text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-2">
            Target Publication Format <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleFormatSelect('article')}
              className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                format === 'article'
                  ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 ring-2 ring-blue-600/20'
                  : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-800/40'
              }`}
            >
              <div className="flex items-center space-x-2 mb-1.5">
                <FileText
                  className={`w-4 h-4 ${format === 'article' ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-500'}`}
                />
                <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Technical Article
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                In-depth markdown article with structured sections & technical depth (~400w).
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleFormatSelect('linkedin_post')}
              className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                format === 'linkedin_post'
                  ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 ring-2 ring-blue-600/20'
                  : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-800/40'
              }`}
            >
              <div className="flex items-center space-x-2 mb-1.5">
                <Share2
                  className={`w-4 h-4 ${format === 'linkedin_post' ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-500'}`}
                />
                <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  LinkedIn Post
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Scroll-stopping hook, concise takeaways, verified bullet points & hashtags (~200w).
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleFormatSelect('twitter_thread')}
              className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                format === 'twitter_thread'
                  ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 ring-2 ring-blue-600/20'
                  : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-800/40'
              }`}
            >
              <div className="flex items-center space-x-2 mb-1.5">
                <MessageSquare
                  className={`w-4 h-4 ${format === 'twitter_thread' ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-500'}`}
                />
                <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  X / Twitter Thread
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Numbered 1/N thread with punchy, verified tweets under 280 characters (~5-8 tweets).
              </p>
            </button>
          </div>
        </div>

        {/* Topic Input */}
        <div>
          <label
            htmlFor="topic"
            className="block text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1.5"
          >
            Technical Subject or Topic <span className="text-rose-500">*</span>
          </label>
          <input
            id="topic"
            type="text"
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={
              format === 'linkedin_post'
                ? 'e.g. Why distributed systems teams use Raft over Paxos'
                : format === 'twitter_thread'
                  ? 'e.g. 5 safety rules of the Raft consensus algorithm'
                  : 'e.g. TypeScript 5.0 Type Parameters, PostgreSQL 16 Performance, Rust Closures'
            }
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
                <option value="engaging, insightful, and professional">Engaging & Professional</option>
                <option value="punchy, technical, and compelling">Punchy & Compelling</option>
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
                min="100"
                max="1200"
                step="25"
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
            <span>Budget Guard Limits (Per Run)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="maxTokens"
                className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
              >
                Max Tokens Allowed
              </label>
              <input
                id="maxTokens"
                type="number"
                min="1000"
                max="500000"
                step="1000"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="maxCostUsd"
                className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
              >
                Max Cost Limit ($ USD)
              </label>
              <input
                id="maxCostUsd"
                type="number"
                min="0.05"
                max="20"
                step="0.05"
                value={maxCostUsd}
                onChange={(e) => setMaxCostUsd(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition shadow-sm hover:shadow flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Launching Multi-Agent Pipeline...</span>
              </>
            ) : (
              <>
                <span>Launch {format === 'article' ? 'Article' : format === 'linkedin_post' ? 'LinkedIn' : 'Twitter'} Pipeline</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
