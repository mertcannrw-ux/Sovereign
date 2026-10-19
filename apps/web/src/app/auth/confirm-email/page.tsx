'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import {
  AuthShell,
  AuthShellFallback,
  FormError,
  submitButton,
} from '@/components/auth/auth-shell';
import { primaryButton } from '@/components/landing/primitives';
import { trpc } from '@/lib/trpc/client';

/**
 * The link in the "confirm your new email" message (account.requestEmailChange).
 * Confirming takes a click rather than happening on load, so mail scanners that
 * prefetch links cannot complete the change.
 */
function ConfirmEmailForm() {
  const token = useSearchParams().get('token') ?? '';
  const { status, update } = useSession();
  const confirm = trpc.account.confirmEmailChange.useMutation();
  const [error, setError] = useState('');

  async function handleConfirm() {
    setError('');
    if (!token) {
      setError('This link is missing its token. Open it again from the email.');
      return;
    }
    try {
      await confirm.mutateAsync({ token });
      // Refresh the email the sidebar shows when this browser is signed in.
      if (status === 'authenticated') await update();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    }
  }

  const done = confirm.isSuccess;
  const next =
    status === 'authenticated'
      ? { href: '/settings?tab=profile', label: 'Back to settings' }
      : { href: '/auth/signin', label: 'Sign in' };

  return (
    <AuthShell
      eyebrow="Account"
      title={done ? 'Email updated' : 'Confirm your new email'}
      aside={{ href: next.href, label: next.label }}
    >
      {done ? (
        <p className="text-sm text-foreground-secondary">
          You&apos;ll sign in with{' '}
          <span className="font-medium text-foreground">{confirm.data.email}</span> from now on.
        </p>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-foreground-secondary">
            Use this address for your Sovereign account. Your current email keeps working until you
            confirm.
          </p>
          {error && <FormError>{error}</FormError>}
          <button
            type="button"
            onClick={handleConfirm}
            className={cn(primaryButton, submitButton)}
            disabled={confirm.isPending}
          >
            {confirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm email
          </button>
        </div>
      )}
      <p className="mt-10 border-t border-border pt-6 text-sm text-foreground-muted">
        <Link href={next.href} className="font-medium text-foreground hover:text-primary">
          {next.label}
        </Link>
      </p>
    </AuthShell>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={<AuthShellFallback />}>
      <ConfirmEmailForm />
    </Suspense>
  );
}
