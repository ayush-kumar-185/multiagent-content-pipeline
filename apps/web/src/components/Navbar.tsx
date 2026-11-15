'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getSystemHealth } from '@/lib/api';
import { History, PlusCircle, User, Cpu, Sparkles } from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [mode, setMode] = useState<'real' | 'mock'>('mock');

  useEffect(() => {
    let mounted = true;
    getSystemHealth()
      .then((health) => {
        if (mounted && health.mode) {
          setMode(health.mode);
        }
      })
      .catch(() => {
        // Default to mock mode if backend offline
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-4 sm:space-x-8">
          <Link href="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-neutral-900 dark:bg-white flex items-center justify-center text-white dark:text-neutral-900 font-bold text-lg">
              C
            </div>
            <span className="font-bold text-lg tracking-tight">CiteWriter</span>
            <span className="hidden sm:inline-flex text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              Verified Multi-Agent
            </span>
          </Link>

          {/* Mode Badge */}
          <div
            data-testid="mode-badge"
            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              mode === 'real'
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800'
            }`}
          >
            {mode === 'real' ? (
              <>
                <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>Mode: Live LLM</span>
              </>
            ) : (
              <>
                <Cpu className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                <span>Mode: Mock (Offline)</span>
              </>
            )}
          </div>

          <nav className="hidden md:flex items-center space-x-1">
            <Link
              href="/"
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                pathname === '/'
                  ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              <span>New Run</span>
            </Link>

            <Link
              href="/history"
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                pathname === '/history'
                  ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
              }`}
            >
              <History className="w-4 h-4" />
              <span>History</span>
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            href="/auth/login"
            className="flex items-center space-x-2 text-xs py-1.5 px-3 rounded-full border border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600 transition"
          >
            <User className="w-3.5 h-3.5 text-neutral-500" />
            <span className="font-medium">{user.name || user.id}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
              Switch
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
