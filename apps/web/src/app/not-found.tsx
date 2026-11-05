import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-20 text-center space-y-4">
      <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">404 - Page Not Found</h2>
      <p className="text-sm text-neutral-500">The requested page does not exist or has been moved.</p>
      <Link
        href="/"
        className="inline-flex items-center px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}

