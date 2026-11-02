import { CITEWRITER_CORE_VERSION } from '@citewriter/core';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">CiteWriter</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          Multi-agent editorial system with sentence-level factual verification.
        </p>
        <div className="inline-block px-3 py-1 text-sm rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200">
          Core Engine v{CITEWRITER_CORE_VERSION}
        </div>
      </div>
    </main>
  );
}
