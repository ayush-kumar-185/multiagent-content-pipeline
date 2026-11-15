'use client';

import React, { useState, useEffect } from 'react';
import { EditorVerdict } from '@/lib/types';
import { resumeRun } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { stripCitations } from '@/lib/formatExport';
import {
  CheckCircle,
  Edit3,
  XCircle,
  Star,
  AlertTriangle,
  Loader2,
  FileCheck2,
} from 'lucide-react';

interface HumanReviewActionsProps {
  runId: string;
  initialDraft: string;
  editorVerdict?: EditorVerdict | null;
  openIssues?: string[];
  onActionComplete: () => Promise<void>;
}

export function HumanReviewActions({
  runId,
  initialDraft,
  editorVerdict,
  openIssues = [],
  onActionComplete,
}: HumanReviewActionsProps) {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editedDraft, setEditedDraft] = useState(() => stripCitations(initialDraft));

  useEffect(() => {
    setEditedDraft(stripCitations(initialDraft));
  }, [initialDraft]);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: 'approve' | 'edit' | 'reject') => {
    setIsSubmitting(true);
    setError(null);

    try {
      await resumeRun(
        runId,
        {
          action,
          editedDraft: action === 'edit' ? editedDraft : undefined,
          feedback: feedback.trim() || undefined,
        },
        user.id,
      );

      await onActionComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action submission failed');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
      {/* Editor Rubric & Score Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-100 dark:border-neutral-800">
        <div>
          <div className="flex items-center space-x-2">
            <FileCheck2 className="w-5 h-5 text-blue-600" />
            <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Editor Agent Verdict
            </h4>
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 max-w-xl">
            {editorVerdict?.feedback ||
              'Article meets factual citation density and stylistic guidelines.'}
          </p>
        </div>

        {editorVerdict?.score !== undefined && (
          <div className="flex items-center space-x-2 sm:self-center px-4 py-2 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-sm flex-shrink-0">
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span className="text-base font-extrabold text-neutral-900 dark:text-neutral-100">
              {editorVerdict.score}
            </span>
            <span className="text-xs text-neutral-400 font-medium">/ 10</span>
          </div>
        )}
      </div>

      {/* Open Issues Warning (if any) */}
      {openIssues.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <div className="font-semibold flex items-center space-x-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Open Verification Notices ({openIssues.length}):</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 pl-1 opacity-90">
            {openIssues.map((issue, idx) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 text-xs">
          {error}
        </div>
      )}

      {/* In-place Markdown Editor Mode */}
      {isEditing && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Edit Article Draft Directly:
          </label>
          <textarea
            rows={12}
            value={editedDraft}
            onChange={(e) => setEditedDraft(e.target.value)}
            className="w-full p-4 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 font-mono text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Optional feedback text */}
      <div>
        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
          Reviewer Notes / Feedback (Optional):
        </label>
        <input
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="e.g. Approved with technical corrections, or reason for rejection"
          className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-medium text-neutral-700 dark:text-neutral-300 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isEditing ? 'Cancel Edit Mode' : 'Edit Draft Manually'}</span>
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleAction('reject')}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-semibold transition disabled:opacity-50"
          >
            <XCircle className="w-4 h-4" />
            <span>Reject</span>
          </button>

          {isEditing ? (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleAction('edit')}
              className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              <span>Save & Approve Edit</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleAction('approve')}
              className="flex items-center space-x-1.5 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              <span>Approve & Finalize Article</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
