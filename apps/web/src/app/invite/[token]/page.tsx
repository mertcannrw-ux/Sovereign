'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import {
  AuthShell,
  AuthShellFallback,
  FormError,
  submitButton,
} from '@/components/auth/auth-shell';
import { primaryButton, secondaryButton } from '@/components/landing/primitives';
import { trpc } from '@/lib/trpc/client';
import { selectRealm } from '@/lib/use-current-realm';

/**
 * Where an invite link lands (realms.invite). Joining takes a click rather
 * than happening on load, so mail scanners that prefetch links cannot accept
 * an invite on someone's behalf. Signing in is enforced by the middleware.
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const details = trpc.realms.inviteDetails.useQuery({ token }, { retry: false });
  const accept = trpc.realms.acceptInvite.useMutation();
  const [error, setError] = useState('');

  async function join() {
    setError('');
    try {
      const { realmId } = await accept.mutateAsync({ token });
      selectRealm(realmId);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    }
  }

  if (details.isLoading) return <AuthShellFallback />;

  const invite = details.data;
  const back = (
    <p className="mt-10 border-t border-border pt-6 text-sm text-foreground-muted">
      <Link href="/dashboard" className="font-medium text-foreground hover:text-primary">
        Go to your projects
      </Link>
    </p>
  );

  if (invite?.state === 'pending') {
    return (
      <AuthShell
        eyebrow="Invite"
        title={`Join ${invite.realmName}`}
        copy={`${invite.invitedBy} invited you to build in this Realm as ${
          invite.role === 'ADMIN' ? 'an admin' : 'a member'
        }. You'll share its projects, keys and brief with everyone in it.`}
      >
        <div className="space-y-5">
          {error && <FormError>{error}</FormError>}
          <button
            type="button"
            onClick={join}
            className={cn(primaryButton, submitButton)}
            disabled={accept.isPending}
          >
            {accept.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Join {invite.realmName}
          </button>
        </div>
        {back}
      </AuthShell>
    );
  }

  if (invite?.state === 'accepted') {
    return (
      <AuthShell eyebrow="Invite" title="You're already in">
        <button
          type="button"
          onClick={() => {
            selectRealm(invite.realmId);
            router.push('/dashboard');
          }}
          className={cn(primaryButton, submitButton)}
        >
          Open the Realm
        </button>
      </AuthShell>
    );
  }

  if (invite?.state === 'wrong-account') {
    return (
      <AuthShell
        eyebrow="Invite"
        title="This invite is for another account"
        copy={`Sign in as ${invite.email} to join.`}
      >
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: `/invite/${token}` })}
          className={cn(secondaryButton, submitButton)}
        >
          Sign in with another account
        </button>
        {back}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Invite"
      title={invite?.state === 'expired' ? 'This invite has expired' : 'This invite is not valid'}
      copy="Ask whoever invited you for a new link."
    >
      {back}
    </AuthShell>
  );
}
