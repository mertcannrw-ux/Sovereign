'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';

export default function ForgotPasswordPage() {
  const requestReset = trpc.auth.requestPasswordReset.useMutation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email) {
      setError('Enter your email address.');
      return;
    }
    try {
      await requestReset.mutateAsync({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a reset.');
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
          <h2 className="mt-3 text-4xl font-semibold tracking-[-0.045em]">Forgot password</h2>
          <p className="mt-3 text-sm leading-6 text-foreground-muted">
            If an account exists for that email, we will send a reset link.
          </p>
        </div>
        {sent ? (
          <p className="rounded-lg border border-border bg-background-subtle px-3.5 py-3 text-sm text-foreground-secondary">
            Check your inbox. If you do not receive an email, password reset may be unconfigured on
            this server.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                placeholder="you@company.com"
                autoComplete="email"
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
            <Button type="submit" size="lg" className="w-full" disabled={requestReset.isPending}>
              {requestReset.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
