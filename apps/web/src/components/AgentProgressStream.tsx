'use client';

import React, { useEffect, useState, useRef } from 'react';
import { RunRecord, RunEventPayload } from '@/lib/types';
import { getEventsStreamUrl } from '@/lib/api';
import {
  Search,
  PenTool,
  ShieldCheck,
  FileCheck2,
  UserCheck,
  CheckCircle2,
  Clock,
  Sparkles,
} from 'lucide-react';

interface AgentProgressStreamProps {
  run: RunRecord;
  onRefreshRun: () => Promise<void>;
}

interface AgentStage {
  id: string;
  name: string;
  role: string;
  icon: React.ComponentType<{ className?: string }>;
}

const AGENT_STAGES: AgentStage[] = [
  { id: 'researcher', name: 'Researcher', role: 'Fact Gathering & Verification', icon: Search },
  { id: 'writer', name: 'Writer', role: 'Drafting with Inline Citations', icon: PenTool },
  {
    id: 'factChecker',
    name: 'Fact-checker',
    role: 'Strict Quote & Number Auditing',
    icon: ShieldCheck,
  },
  { id: 'editor', name: 'Editor', role: 'Style, Flow & Rubric Scoring', icon: FileCheck2 },
  { id: 'humanReview', name: 'Human Review', role: 'Approval & Final Verdict', icon: UserCheck },
];

export function AgentProgressStream({ run, onRefreshRun }: AgentProgressStreamProps) {
  const [events, setEvents] = useState<RunEventPayload[]>([]);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState<boolean>(false);
  const lastSequenceRef = useRef<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect and reconnect to SSE stream
  useEffect(() => {
    // Terminal states don't need active stream
    if (['approved', 'rejected', 'failed'].includes(run.status)) {
      return;
    }

    const connectSSE = () => {
      const url = getEventsStreamUrl(run.id, lastSequenceRef.current);
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStreamConnected(true);
      };

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data) as RunEventPayload;
          handleIncomingEvent(payload);
        } catch {
          // Keepalive or unparseable
        }
      };

      // Listen for custom event types
      const eventTypes = [
        'run_created',
        'node_start',
        'node_end',
        'status_change',
        'review_ready',
        'run_completed',
        'run_failed',
        'budget_exceeded',
      ];

      for (const evtType of eventTypes) {
        es.addEventListener(evtType, (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data) as RunEventPayload;
            handleIncomingEvent(payload);
          } catch {
            // Ignore
          }
        });
      }

      es.onerror = () => {
        setStreamConnected(false);
        es.close();
        // Reconnect with backoff if not in terminal status
        if (!['approved', 'rejected', 'failed'].includes(run.status)) {
          setTimeout(connectSSE, 2000);
        }
      };
    };

    const handleIncomingEvent = (evt: RunEventPayload) => {
      if (evt.sequence > lastSequenceRef.current) {
        lastSequenceRef.current = evt.sequence;
      }

      setEvents((prev) => {
        if (prev.some((e) => e.sequence === evt.sequence)) return prev;
        return [...prev, evt].sort((a, b) => a.sequence - b.sequence);
      });

      if (evt.node) {
        setActiveNode(evt.node);
      }

      // If status changed or review ready, refresh parent run state
      if (
        [
          'status_change',
          'review_ready',
          'run_completed',
          'run_failed',
          'budget_exceeded',
        ].includes(evt.type)
      ) {
        onRefreshRun();
      }
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [run.id, run.status, onRefreshRun]);

  const getStageState = (stageId: string): 'completed' | 'active' | 'pending' => {
    if (run.status === 'approved' || run.status === 'rejected') {
      return 'completed';
    }

    if (stageId === 'humanReview') {
      if (run.status === 'awaiting_review') return 'active';
      return 'pending';
    }

    if (activeNode === stageId) {
      return 'active';
    }

    // Check if stage has completed events
    const hasEnded = events.some((e) => e.node === stageId && e.type === 'node_end');
    if (hasEnded) return 'completed';

    return 'pending';
  };

  return (
    <div className="space-y-6">
      {/* Agent Workflow Stepper */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100 flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Multi-Agent Execution Pipeline</span>
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Deterministic routing with state persistence across each agent node
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                streamConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span className="text-xs font-medium text-neutral-500">
              {streamConnected ? 'Live SSE' : 'Connecting...'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {AGENT_STAGES.map((stage) => {
            const Icon = stage.icon;
            const state = getStageState(stage.id);

            return (
              <div
                key={stage.id}
                className={`relative p-3 rounded-xl border text-left transition-all ${
                  state === 'active'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                    : state === 'completed'
                      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/20 text-neutral-800 dark:text-neutral-200'
                      : 'border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/30 opacity-60 text-neutral-500'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div
                    className={`p-1.5 rounded-lg ${
                      state === 'active'
                        ? 'bg-blue-600 text-white'
                        : state === 'completed'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  {state === 'active' && (
                    <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 animate-pulse">
                      Active
                    </span>
                  )}
                  {state === 'completed' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {state === 'pending' && <Clock className="w-3 h-3 text-neutral-400" />}
                </div>

                <div className="text-xs font-semibold">{stage.name}</div>
                <div className="text-[10px] text-neutral-500 line-clamp-1">{stage.role}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Real-time Event Feed */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 shadow-sm">
        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3 flex items-center justify-between">
          <span>Live Execution Event Stream</span>
          <span className="text-[10px] font-normal text-neutral-400">
            {events.length} event{events.length === 1 ? '' : 's'} recorded
          </span>
        </h4>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1 text-xs font-mono">
          {events.length === 0 ? (
            <div className="text-neutral-400 py-4 text-center italic">
              Waiting for agent activity...
            </div>
          ) : (
            events.map((evt) => (
              <div
                key={evt.sequence}
                className="p-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-100 dark:border-neutral-800 flex items-start space-x-2"
              >
                <span className="text-neutral-400 font-semibold select-none">
                  #{evt.sequence.toString().padStart(2, '0')}
                </span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">[{evt.type}]</span>
                {evt.node && (
                  <span className="text-purple-600 dark:text-purple-400 font-medium">
                    @{evt.node}:
                  </span>
                )}
                <span className="text-neutral-700 dark:text-neutral-300 truncate flex-1">
                  {JSON.stringify(evt.data)}
                </span>
                <span className="text-[10px] text-neutral-400 flex-shrink-0">
                  {new Date(evt.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
