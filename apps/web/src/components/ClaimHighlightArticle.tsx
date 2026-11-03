'use client';

import React, { useState } from 'react';
import { Claim, ClaimCheck, Note } from '@/lib/types';
import {
  ShieldCheck,
  AlertOctagon,
  HelpCircle,
  ExternalLink,
  Quote,
  X,
  FileText,
} from 'lucide-react';

interface ClaimHighlightArticleProps {
  draft: string;
  claims: Claim[];
  claimChecks: ClaimCheck[];
  notes: Note[];
}

export function ClaimHighlightArticle({
  draft,
  claims,
  claimChecks,
  notes,
}: ClaimHighlightArticleProps) {
  const [selectedClaimIndex, setSelectedClaimIndex] = useState<number | null>(null);

  // Map notes by ID for instant O(1) lookup
  const notesMap = new Map<string, Note>();
  for (const n of notes) {
    notesMap.set(n.id, n);
  }

  // Map checks by claim text or index
  const checksMap = new Map<string, ClaimCheck>();
  for (const c of claimChecks) {
    checksMap.set(c.claim.trim(), c);
  }

  const selectedClaim = selectedClaimIndex !== null ? claims[selectedClaimIndex] : null;
  const selectedCheck = selectedClaim ? checksMap.get(selectedClaim.claim.trim()) : null;

  // Render article text with interactive claim spans
  const renderArticle = () => {
    if (!draft) {
      return (
        <div className="text-neutral-400 italic py-8 text-center">
          No article draft generated yet.
        </div>
      );
    }

    if (!claims || claims.length === 0) {
      return (
        <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap font-serif leading-relaxed text-neutral-800 dark:text-neutral-200">
          {draft}
        </div>
      );
    }

    // Split draft by paragraphs
    const paragraphs = draft.split(/\n\s*\n/);

    return (
      <div className="space-y-4 font-serif text-base sm:text-lg leading-relaxed text-neutral-800 dark:text-neutral-200">
        {paragraphs.map((p, pIdx) => {
          // If heading
          if (p.startsWith('#')) {
            const level = p.match(/^#+/)?.[0].length ?? 1;
            const text = p.replace(/^#+\s*/, '');
            if (level === 1) {
              return (
                <h1
                  key={pIdx}
                  className="font-sans text-2xl sm:text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 pt-2 pb-1"
                >
                  {text}
                </h1>
              );
            }
            return (
              <h2
                key={pIdx}
                className="font-sans text-xl sm:text-2xl font-bold text-neutral-900 dark:text-neutral-100 pt-2 pb-1"
              >
                {text}
              </h2>
            );
          }

          // Search for claims present in this paragraph
          return (
            <p key={pIdx} className="leading-relaxed">
              {renderParagraphWithClaims(p)}
            </p>
          );
        })}
      </div>
    );
  };

  const renderParagraphWithClaims = (paragraphText: string) => {
    // Find all claims matching this paragraph
    const matchingClaims = claims
      .map((c, idx) => ({ ...c, originalIdx: idx }))
      .filter((c) => paragraphText.includes(c.claim.trim()));

    if (matchingClaims.length === 0) {
      return paragraphText;
    }

    // Replace claim occurrences with interactive highlighted spans
    let remaining = paragraphText;
    const parts: React.ReactNode[] = [];

    while (remaining.length > 0) {
      let earliestMatch: { claim: (typeof matchingClaims)[0]; pos: number } | null = null;

      for (const mc of matchingClaims) {
        const pos = remaining.indexOf(mc.claim.trim());
        if (pos !== -1) {
          if (!earliestMatch || pos < earliestMatch.pos) {
            earliestMatch = { claim: mc, pos };
          }
        }
      }

      if (!earliestMatch) {
        parts.push(remaining);
        break;
      }

      if (earliestMatch.pos > 0) {
        parts.push(remaining.slice(0, earliestMatch.pos));
      }

      const cl = earliestMatch.claim;
      const check = checksMap.get(cl.claim.trim());
      const status = check?.status ?? 'supported';
      const isSelected = selectedClaimIndex === cl.originalIdx;

      let badgeClasses = 'bg-neutral-100 border-neutral-300 text-neutral-700';
      if (status === 'supported') {
        badgeClasses =
          'bg-emerald-500/15 border-b-2 border-emerald-500 text-neutral-900 dark:text-neutral-100 hover:bg-emerald-500/25';
      } else if (status === 'unsupported') {
        badgeClasses =
          'bg-rose-500/20 border-b-2 border-rose-500 text-neutral-900 dark:text-neutral-100 hover:bg-rose-500/30';
      } else if (status === 'needs_more_research') {
        badgeClasses =
          'bg-amber-500/20 border-b-2 border-amber-500 text-neutral-900 dark:text-neutral-100 hover:bg-amber-500/30';
      }

      parts.push(
        <mark
          key={`claim-${cl.originalIdx}-${earliestMatch.pos}`}
          onClick={() => setSelectedClaimIndex(cl.originalIdx)}
          className={`cursor-pointer px-1 py-0.5 rounded transition inline font-serif ${badgeClasses} ${
            isSelected ? 'ring-2 ring-blue-500' : ''
          }`}
          title="Click to inspect citation and factual verification"
        >
          {cl.claim}
          <sup className="font-sans font-bold text-[11px] ml-1 text-blue-600 dark:text-blue-400 select-none">
            {cl.noteIds.map((id) => `[${id}]`).join('')}
          </sup>
        </mark>,
      );

      remaining = remaining.slice(earliestMatch.pos + cl.claim.trim().length);
    }

    return parts;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Article Text Column */}
      <div className="lg:col-span-7 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-4 mb-6">
          <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            <FileText className="w-4 h-4 text-blue-600" />
            <span>Interactive Article Draft</span>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <span className="flex items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Supported</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>Needs Research</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>Unsupported</span>
            </span>
          </div>
        </div>

        {renderArticle()}
      </div>

      {/* Claim Inspection Sidebar Column */}
      <div className="lg:col-span-5 sticky top-24 space-y-4">
        {selectedClaim ? (
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 shadow-md transition">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800 mb-4">
              <div className="flex items-center space-x-2">
                {selectedCheck?.status === 'supported' ? (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Fact Verified</span>
                  </div>
                ) : selectedCheck?.status === 'unsupported' ? (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                    <AlertOctagon className="w-3.5 h-3.5" />
                    <span>Unsupported</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Needs More Research</span>
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedClaimIndex(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1"
                aria-label="Close claim drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Claim Statement */}
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                Claim in Draft
              </div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 leading-snug">
                &ldquo;{selectedClaim.claim}&rdquo;
              </p>
            </div>

            {/* Fact Checker Reason */}
            {selectedCheck?.reason && (
              <div className="mb-4 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-100 dark:border-neutral-800 text-xs">
                <div className="font-semibold text-neutral-700 dark:text-neutral-300 mb-0.5">
                  Fact-checker Audit:
                </div>
                <div className="text-neutral-600 dark:text-neutral-400">{selectedCheck.reason}</div>
              </div>
            )}

            {/* Cited Sources & Quotes */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-2">
                Cited Sources ({selectedClaim.noteIds.length})
              </div>

              <div className="space-y-3">
                {selectedClaim.noteIds.map((noteId) => {
                  const note = notesMap.get(noteId);
                  if (!note) {
                    return (
                      <div
                        key={noteId}
                        className="p-3 rounded-xl border border-rose-200 bg-rose-50/50 text-xs text-rose-700"
                      >
                        Unknown Note ID [{noteId}] — Flagged as missing citation
                      </div>
                    );
                  }

                  return (
                    <div
                      key={note.id}
                      className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/40 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                          [{note.id}]
                        </span>
                        <a
                          href={note.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium truncate max-w-[200px]"
                        >
                          <span className="truncate">{note.sourceUrl}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      </div>

                      <div className="p-2 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700/60 font-serif italic text-neutral-700 dark:text-neutral-300">
                        <Quote className="w-3 h-3 inline mr-1 text-neutral-400 -mt-1" />
                        &ldquo;{note.quote}&rdquo;
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 text-center shadow-sm">
            <ShieldCheck className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              Sentence-Level Claim Verification
            </h4>
            <p className="text-xs text-neutral-500 mt-1">
              Click on any highlighted sentence in the article to inspect its exact source quotes,
              verified URL, and fact-checker assessment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
