'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import {
  AuthShell,
  AuthShellFallback,
  FormError,
  fieldInput,
  fieldLabel,
  submitButton,
} from '@/components/auth/auth-shell';
import { primaryButton } from '@/components/landing/primitives';
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
    <AuthShell
      eyebrow="Account recovery"
      title="Set a new password"
      aside={{ href: '/auth/signin', label: 'Sign in' }}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="password" className={fieldLabel}>
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
            className={fieldInput}
            required
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <button
          type="submit"
          className={cn(primaryButton, submitButton)}
          disabled={reset.isPending}
        >
          {reset.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Update password
        </button>
      </form>
      <p className="mt-10 border-t border-border pt-6 text-sm text-foreground-muted">
        <Link href="/auth/signin" className="font-medium text-foreground hover:text-primary">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShellFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
