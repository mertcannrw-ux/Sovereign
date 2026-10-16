'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import {
  AuthShell,
  FormError,
  fieldInput,
  fieldLabel,
  submitButton,
} from '@/components/auth/auth-shell';
import { primaryButton } from '@/components/landing/primitives';
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
    <AuthShell
      eyebrow="Account recovery"
      title="Forgot password"
      copy="If an account exists for that email, we will send a reset link."
      aside={{ href: '/auth/signin', label: 'Sign in' }}
    >
      {sent ? (
        <p className="rounded-md border border-border bg-background-subtle px-3.5 py-3 text-sm text-foreground-secondary">
          Check your inbox. If you do not receive an email, password reset may be unconfigured on
          this server.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="email" className={fieldLabel}>
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
              className={fieldInput}
              required
            />
          </div>
          {error && <FormError>{error}</FormError>}
          <button
            type="submit"
            className={cn(primaryButton, submitButton)}
            disabled={requestReset.isPending}
          >
            {requestReset.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Send reset link
          </button>
        </form>
      )}
      <p className="mt-10 border-t border-border pt-6 text-sm text-foreground-muted">
        Remembered it?{' '}
        <Link href="/auth/signin" className="font-medium text-foreground hover:text-primary">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
