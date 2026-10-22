'use client';

import { useState, type FormEvent } from 'react';
import { Ellipsis, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CreateRealmDialog } from '@/components/realms/create-realm-dialog';
import { LeaveRealmDialog } from '@/components/realms/leave-realm-dialog';
import { initials } from '@/lib/initials';
import { trpc } from '@/lib/trpc/client';
import { canManageRealm, useCurrentRealm } from '@/lib/use-current-realm';
import type { RealmRole } from '@app-builder/shared';

type InviteRole = 'MEMBER' | 'ADMIN';

const ROLE_LABELS = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' } as const;

/**
 * Realm settings > Members: who builds in the current Realm, and who is
 * invited. `onLeft` runs after you leave the Realm from your own row.
 */
export function MembersPanel({ onLeft }: { onLeft?: () => void }) {
  const { realm } = useCurrentRealm();
  const [creating, setCreating] = useState(false);

  if (!realm) {
    return <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />;
  }

  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">Members</h2>
      {realm.type === 'PERSONAL' ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-card border border-border px-5 py-4">
          <p className="text-sm text-foreground-secondary">
            This is your personal Realm. Create a shared Realm to build with others.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            Create Realm
          </Button>
          <CreateRealmDialog open={creating} onOpenChange={setCreating} />
        </div>
      ) : (
        <SharedRealmMembers realm={realm} onLeft={onLeft} />
      )}
    </section>
  );
}

function SharedRealmMembers({
  realm,
  onLeft,
}: {
  realm: { id: string; name: string; role: RealmRole };
  onLeft?: () => void;
}) {
  const realmId = realm.id;
  const canManage = canManageRealm(realm.role);
  const utils = trpc.useUtils();
  const { data: me } = trpc.auth.getSession.useQuery();
  const [leaving, setLeaving] = useState(false);
  const membersQuery = trpc.realms.listMembers.useQuery({ realmId });
  const others = (membersQuery.data ?? [])
    .filter((member) => member.userId !== me?.user.id)
    .map((member) => ({ userId: member.userId, name: member.user.name ?? member.user.email }));
  const invitesQuery = trpc.realms.listInvites.useQuery({ realmId }, { enabled: canManage });
  const refresh = () =>
    Promise.all([
      utils.realms.listMembers.invalidate({ realmId }),
      utils.realms.listInvites.invalidate({ realmId }),
      utils.realms.list.invalidate(),
    ]);

  return (
    <div className="mt-6 space-y-8">
      {canManage && <InviteForm realmId={realmId} onInvited={refresh} />}

      <ul className="divide-y divide-border rounded-card border border-border">
        {membersQuery.isLoading && (
          <li className="px-5 py-4">
            <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />
          </li>
        )}
        {(membersQuery.data ?? []).map((member) => (
          <MemberRow
            key={member.userId}
            realmId={realmId}
            member={member}
            canManage={canManage}
            isSelf={member.userId === me?.user.id}
            onLeave={() => setLeaving(true)}
            onChanged={refresh}
          />
        ))}
      </ul>

      {canManage && (invitesQuery.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground">Pending invites</h3>
          <ul className="mt-3 divide-y divide-border rounded-card border border-border">
            {(invitesQuery.data ?? []).map((invite) => (
              <InviteRow key={invite.id} realmId={realmId} invite={invite} onChanged={refresh} />
            ))}
          </ul>
        </div>
      )}

      <LeaveRealmDialog
        open={leaving}
        onOpenChange={setLeaving}
        realmId={realmId}
        realmName={realm.name}
        isOwner={realm.role === 'OWNER'}
        others={others}
        onLeft={() => onLeft?.()}
      />
    </div>
  );
}

function InviteForm({ realmId, onInvited }: { realmId: string; onInvited: () => unknown }) {
  const inviteMutation = trpc.realms.invite.useMutation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when the freshly rotated invite link could not be copied automatically. */
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [pending, setPending] = useState<'invite' | 'link' | null>(null);

  async function send(sendEmail: boolean) {
    const address = email.trim();
    if (!address) {
      setError('Enter their email first.');
      return;
    }
    setError(null);
    setNotice(null);
    setPending(sendEmail ? 'invite' : 'link');
    try {
      const invite = await inviteMutation.mutateAsync({ realmId, email: address, role, sendEmail });
      if (sendEmail) {
        setNotice(
          invite.emailed
            ? `Invite sent to ${invite.email}.`
            : `Couldn't email ${invite.email}. Copy the invite link instead.`,
        );
        // Replace the link every time: a new invite rotates the token, so a
        // link left over from an earlier failed send is already dead.
        setManualLink(invite.emailed ? null : invite.link);
      } else {
        // The token has already rotated by the time this runs, so a rejected
        // clipboard write must not swallow the only copy of the new link.
        try {
          await navigator.clipboard.writeText(invite.link);
          setNotice(`Invite link for ${invite.email} copied.`);
          setManualLink(null);
        } catch {
          setNotice(`Copy the invite link for ${invite.email} before leaving this page.`);
          setManualLink(invite.link);
        }
      }
      setEmail('');
      await onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invite.');
    } finally {
      setPending(null);
    }
  }

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void send(true);
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="email"
          aria-label="Email"
          placeholder="name@company.com"
          autoComplete="off"
          value={email}
          error={error !== null}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Select value={role} onValueChange={(value) => setRole(value as InviteRole)}>
          <SelectTrigger aria-label="Role" className="sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MEMBER">Member</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" variant="secondary" disabled={pending !== null}>
          {pending === 'invite' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Invite
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button
          type="button"
          variant="link"
          className="h-auto px-0 text-sm font-medium text-foreground-secondary hover:text-foreground"
          disabled={pending !== null}
          onClick={() => void send(false)}
        >
          Copy invite link
        </Button>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-foreground-muted">
            {notice}
          </p>
        )}
        {manualLink && (
          <label className="basis-full text-xs text-foreground-muted">
            Invite link
            <input
              readOnly
              value={manualLink}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Invite link"
              className="mt-1 w-full rounded-control border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
            />
          </label>
        )}
      </div>
    </form>
  );
}

function MemberRow({
  realmId,
  member,
  canManage,
  isSelf,
  onLeave,
  onChanged,
}: {
  realmId: string;
  member: {
    userId: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    user: { name: string | null; email: string; avatarUrl: string | null };
  };
  canManage: boolean;
  /** Your own row: never editable here, and it offers Leave instead. */
  isSelf: boolean;
  onLeave: () => void;
  onChanged: () => unknown;
}) {
  const roleMutation = trpc.realms.updateMemberRole.useMutation({ onSuccess: onChanged });
  const removeMutation = trpc.realms.removeMember.useMutation({ onSuccess: onChanged });
  const [error, setError] = useState<string | null>(null);
  const name = member.user.name ?? member.user.email;
  const editable = canManage && member.role !== 'OWNER' && !isSelf;

  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <Avatar className="h-8 w-8 shrink-0">
        {member.user.avatarUrl ? <AvatarImage src={member.user.avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-background-muted text-xs font-medium text-foreground-secondary">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {name}
          {isSelf && <span className="font-normal text-foreground-muted"> (you)</span>}
        </p>
        <p className="truncate text-xs text-foreground-muted">{member.user.email}</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-error">
            {error}
          </p>
        )}
      </div>
      {editable ? (
        <Select
          value={member.role}
          disabled={roleMutation.isPending}
          onValueChange={(role) => {
            setError(null);
            roleMutation.mutate(
              { realmId, userId: member.userId, role: role as InviteRole },
              { onError: (err) => setError(err.message) },
            );
          }}
        >
          <SelectTrigger aria-label={`Role of ${name}`} className="h-8 w-28 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MEMBER">Member</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span className="w-28 text-right text-sm text-foreground-muted">
          {ROLE_LABELS[member.role]}
        </span>
      )}
      {/* One fixed-width action column keeps every row aligned. */}
      <div className="flex w-16 shrink-0 justify-end">
        {isSelf ? (
          <Button variant="secondary" size="sm" className="h-8 px-3" onClick={onLeave}>
            Leave
          </Button>
        ) : editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`}>
                <Ellipsis className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-error focus:text-error"
                onSelect={() => {
                  if (!window.confirm(`Remove ${name} from this Realm?`)) return;
                  setError(null);
                  removeMutation.mutate(
                    { realmId, userId: member.userId },
                    { onError: (err) => setError(err.message) },
                  );
                }}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}

function InviteRow({
  realmId,
  invite,
  onChanged,
}: {
  realmId: string;
  invite: { id: string; email: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' };
  onChanged: () => unknown;
}) {
  const resendMutation = trpc.realms.resendInvite.useMutation();
  const revokeMutation = trpc.realms.revokeInvite.useMutation({ onSuccess: onChanged });
  const [status, setStatus] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{invite.email}</p>
        <p className="text-xs text-foreground-muted">
          {ROLE_LABELS[invite.role]}
          {status ? ` · ${status}` : ''}
        </p>
        {link && (
          <input
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={`New invite link for ${invite.email}`}
            className="mt-1 w-full rounded-control border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
          />
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={resendMutation.isPending}
        onClick={() =>
          resendMutation.mutate(
            { realmId, inviteId: invite.id },
            {
              onSuccess: (result) => {
                setStatus(result.emailed ? 'Sent again' : "Couldn't email - copy the link");
                // Resending replaced the old token; keep the replacement usable
                // even when the mail did not go out.
                setLink(result.emailed ? null : result.link);
              },
              onError: (err) => setStatus(err.message),
            },
          )
        }
      >
        Resend
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={revokeMutation.isPending}
        onClick={() =>
          revokeMutation.mutate(
            { realmId, inviteId: invite.id },
            { onError: (err) => setStatus(err.message) },
          )
        }
      >
        Revoke
      </Button>
    </li>
  );
}
