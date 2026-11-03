import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { Navbar } from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'CiteWriter | Verified Multi-Agent Technical Authoring',
  description:
    'A multi-agent system with sentence-level verifiable citations powered by LangGraph, fastify, and modern TypeScript.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col font-sans">
        <AuthProvider>
          <Navbar />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
          <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6 text-center text-xs text-neutral-500">
            CiteWriter Portfolio Architecture — Verified Sentence-Level Multi-Agent Technical
            Article Pipeline
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
