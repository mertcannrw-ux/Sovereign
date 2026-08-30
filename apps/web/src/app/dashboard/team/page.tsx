'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';

export default function TeamPage() {
  const { status } = useSession();
  const router = useRouter();
  const orgsQuery = trpc.organizations.list.useQuery();
  const [orgId, setOrgId] = useState<string>('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
  }, [status, router]);

  useEffect(() => {
    if (!orgId && orgsQuery.data?.[0]?.id) {
      setOrgId(orgsQuery.data[0].id);
    }
  }, [orgId, orgsQuery.data]);

  const selectedOrg = useMemo(
    () => orgsQuery.data?.find((org: { id: string; role: string }) => org.id === orgId),
    [orgsQuery.data, orgId],
  );
  const canInvite = selectedOrg?.role === 'OWNER' || selectedOrg?.role === 'ADMIN';

  const membersQuery = trpc.organizations.listMembers.useQuery(
    { organizationId: orgId },
    { enabled: Boolean(orgId) },
  );
  const invitesQuery = trpc.organizations.listInvites.useQuery(
    { organizationId: orgId },
    { enabled: Boolean(orgId) && canInvite },
  );
  const inviteMutation = trpc.organizations.invite.useMutation();
  const revokeMutation = trpc.organizations.revokeInvite.useMutation();
  const removeMutation = trpc.organizations.removeMember.useMutation();

  async function refresh() {
    await Promise.all([membersQuery.refetch(), invitesQuery.refetch(), orgsQuery.refetch()]);
  }

  async function handleInvite() {
    setError('');
    if (!orgId || !email.trim()) return;
    try {
      await inviteMutation.mutateAsync({
        organizationId: orgId,
        email: email.trim(),
        role,
      });
      setEmail('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invite.');
    }
  }

  if (status === 'loading' || orgsQuery.isLoading) {
    return (
      <div className="grid min-h-full place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-4xl px-5 py-9 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Workspace</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">Team</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-muted">
            Members of your organization. Owners and admins can invite people as members or admins.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-5 py-8 sm:px-8">
        {(orgsQuery.data?.length ?? 0) > 1 && (
          <label className="block text-sm font-medium">
            Organization
            <select
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            >
              {(orgsQuery.data ?? []).map((org: { id: string; name: string }) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {canInvite && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="text-sm font-medium">Invite a teammate</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  type="email"
                  placeholder="teammate@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <select
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'MEMBER' | 'ADMIN')}
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <Button onClick={handleInvite} disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                  Invite
                </Button>
              </div>
              {error && <p className="text-sm text-error">{error}</p>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {(membersQuery.data ?? []).map((member: { userId: string; role: string; user: { name: string | null; email: string } }) => (
                <li key={member.userId} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{member.user.name ?? member.user.email}</p>
                    <p className="text-xs text-foreground-muted">{member.user.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                      {member.role}
                    </span>
                    {canInvite && member.role !== 'OWNER' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove member"
                        onClick={async () => {
                          await removeMutation.mutateAsync({ organizationId: orgId, userId: member.userId });
                          await refresh();
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
              {membersQuery.data?.length === 0 && (
                <li className="px-5 py-8 text-sm text-foreground-muted">No members found.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        {canInvite && (invitesQuery.data?.length ?? 0) > 0 && (
          <Card>
            <CardContent className="p-0">
              <p className="px-5 pt-5 text-sm font-medium">Pending invites</p>
              <ul className="divide-y divide-border">
                {(invitesQuery.data ?? []).map((invite: { id: string; email: string; role: string; expiresAt: Date }) => (
                  <li key={invite.id} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="text-sm text-foreground">{invite.email}</p>
                      <p className="text-xs text-foreground-muted">{invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await revokeMutation.mutateAsync({ organizationId: orgId, inviteId: invite.id });
                        await refresh();
                      }}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
