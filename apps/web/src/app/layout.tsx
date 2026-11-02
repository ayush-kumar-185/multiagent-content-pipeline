import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CiteWriter',
  description: 'Multi-agent verified technical article authoring',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
