'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-4 text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="mb-6 text-foreground-secondary">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary-hover"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
