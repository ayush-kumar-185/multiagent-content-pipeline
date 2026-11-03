'use client';

import React, { useEffect, useState } from 'react';
import { NewRunForm } from '@/components/NewRunForm';
import { RunHistoryTable } from '@/components/RunHistoryTable';
import { listRuns } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RunRecord } from '@/lib/types';
import { ShieldCheck, History } from 'lucide-react';

export default function HomePage() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    listRuns(user.id)
      .then((data) => {
        if (isMounted) setRuns(data.slice(0, 5)); // Show recent 5 runs
      })
      .catch(() => {
        // Silently handle initial fetch failure
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [user.id]);

  return (
    <div className="space-y-10">
      {/* Hero Header */}
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 text-xs font-semibold text-blue-700 dark:text-blue-300">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Every Factual Claim Cited & Code-Verified Against Source</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50">
          Technical Articles with Bulletproof Factual Citations
        </h1>

        <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-400">
          Four autonomous agents cooperate: Researcher gathers verified quotes, Writer drafts with
          inline references, Fact-checker audits quotes and numeric literals, and Editor polishes
          against a rigorous rubric.
        </p>
      </div>

      {/* New Run Form */}
      <div className="max-w-3xl mx-auto">
        <NewRunForm />
      </div>

      {/* Recent Runs Section */}
      <div className="max-w-5xl mx-auto pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-500 flex items-center space-x-2">
            <History className="w-4 h-4 text-neutral-400" />
            <span>Recent Authoring Runs</span>
          </h3>

          {runs.length > 0 && (
            <a
              href="/history"
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all history &rarr;
            </a>
          )}
        </div>

        <RunHistoryTable runs={runs} isLoading={isLoading} />
      </div>
    </div>
  );
}
