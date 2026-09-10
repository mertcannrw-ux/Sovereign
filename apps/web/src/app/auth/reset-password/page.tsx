'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const reset = trpc.auth.resetPassword.useMutation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('This reset link is missing a token.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    try {
      await reset.mutateAsync({ token, password });
      router.push('/auth/signin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[430px]">
        <Link
          href="/auth/signin"
          className="mb-12 flex items-center gap-2 text-sm text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
        <div className="mb-9">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Account recovery
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-0.045em]">Set a new password</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              New password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-error/20 bg-error/10 px-3.5 py-3 text-sm text-error"
            >
              {error}
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={reset.isPending}>
            {reset.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center text-sm text-foreground-muted">
          Loading…
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
