'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RealmMark } from '@/components/realms/realm-mark';
import { trpc } from '@/lib/trpc/client';
import { selectRealm } from '@/lib/use-current-realm';

/** How often an open app looks for new invites, besides on window focus. */
const POLL_MS = 30_000;

/**
 * A small card, top right, when someone has invited you to a Realm. Accepting
 * joins and switches to it; declining tells the inviter no. One invite at a
 * time, oldest first. Not a modal: it never blocks the page or its shortcuts.
 */
export function RealmInvitePrompt() {
  const utils = trpc.useUtils();
  const invitesQuery = trpc.realms.myInvites.useQuery(undefined, {
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const respond = trpc.realms.respondToInvite.useMutation({
    onSuccess: async ({ realmId, joined }) => {
      if (joined) {
        await utils.realms.list.invalidate();
        selectRealm(realmId);
      }
    },
    // Errors are reported by the global mutation toast. Refetch either way:
    // an invite withdrawn meanwhile should leave the card.
    onSettled: () => utils.realms.myInvites.invalidate(),
  });

  const invite = invitesQuery.data?.[0];
  if (!invite) return null;

  const answering = respond.isPending ? respond.variables?.accept : undefined;

  return (
    <section
      aria-label="Realm invite"
      aria-live="polite"
      className="fixed right-4 top-4 z-50 w-[calc(100%-2rem)] max-w-sm rounded-card border border-border bg-background-subtle p-4 shadow-popover"
    >
      <div className="flex items-start gap-3">
        <RealmMark name={invite.realmName} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {invite.invitedBy} invited you to {invite.realmName}
          </p>
          <p className="mt-1 text-sm text-foreground-muted">
            Join as {invite.role === 'ADMIN' ? 'an admin' : 'a member'} to build with them.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ inviteId: invite.id, accept: false })}
        >
          {answering === false && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Decline
        </Button>
        <Button
          size="sm"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ inviteId: invite.id, accept: true })}
        >
          {answering === true && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Accept
        </Button>
      </div>
    </section>
  );
}
