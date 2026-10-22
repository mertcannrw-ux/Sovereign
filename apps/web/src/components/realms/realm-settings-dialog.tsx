'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { CreditCard, Loader2, Settings2, Users } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { AIProvidersPanel } from '@/components/settings/ai-providers-panel';
import { BillingPanel } from '@/components/settings/billing-panel';
import { MembersPanel } from '@/components/settings/members-panel';
import { AIKey } from '@/components/ui/ai-key-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/trpc/client';
import {
  canManageRealm,
  useCurrentRealm,
  type RealmSettingsSection,
} from '@/lib/use-current-realm';

/** Errors show next to the action that failed, not as a toast. */
const inlineError = { meta: { inlineError: true } };

const SECTIONS: { id: RealmSettingsSection; label: string; icon: typeof Settings2 }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'providers', label: 'AI Providers', icon: AIKey },
  { id: 'billing', label: 'Billing', icon: CreditCard },
];

/**
 * The current Realm's settings menu: its name and lifecycle (General), who
 * builds in it (Members), the keys they build with (AI Providers) and its plan
 * (Billing).
 * Opened from the Realm
 * switcher, so Settings stays about you. `onGone` runs after you leave or
 * delete the Realm; the current Realm then falls back to your personal one.
 */
export function RealmSettingsDialog({
  open,
  section,
  onSectionChange,
  onOpenChange,
  onGone,
}: {
  open: boolean;
  section: RealmSettingsSection;
  onSectionChange: (section: RealmSettingsSection) => void;
  onOpenChange: (open: boolean) => void;
  onGone: () => void;
}) {
  const { realm } = useCurrentRealm();
  const closeAfterGone = () => {
    onOpenChange(false);
    onGone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(720px,calc(100dvh-2rem))] max-w-4xl flex-col overflow-hidden p-0 md:flex-row"
      >
        <nav
          aria-label="Realm settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-3 pr-14 md:w-56 md:flex-col md:border-b-0 md:border-r md:p-4"
        >
          <DialogTitle className="sr-only md:not-sr-only md:px-3 md:pb-3 md:pt-1">
            <span className="block text-xs font-medium text-foreground-muted">Realm settings</span>
            <span className="mt-1 block truncate text-sm font-semibold text-foreground">
              {realm?.name ?? 'Realm'}
            </span>
          </DialogTitle>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                'flex h-10 shrink-0 items-center gap-3 rounded-item px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                section === item.id
                  ? 'bg-background-muted text-foreground'
                  : 'text-foreground-muted hover:bg-background-muted/60 hover:text-foreground',
              )}
            >
              <item.icon className={cn('h-4 w-4', section === item.id && 'text-primary')} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
          {/* Keyed by Realm so each one starts from its saved values. */}
          {open && realm && section === 'general' && (
            <GeneralSection key={realm.id} realm={realm} onGone={closeAfterGone} />
          )}
          {open && realm && section === 'members' && <MembersPanel onLeft={closeAfterGone} />}
          {open && realm && section === 'providers' && <AIProvidersPanel />}
          {open && realm && section === 'billing' && <BillingPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type CurrentRealm = NonNullable<ReturnType<typeof useCurrentRealm>['realm']>;

function GeneralSection({ realm, onGone }: { realm: CurrentRealm; onGone: () => void }) {
  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">General</h2>
      <RealmRows realm={realm} onGone={onGone} />
    </section>
  );
}

function RealmRows({ realm, onGone }: { realm: CurrentRealm; onGone: () => void }) {
  const shared = realm.type === 'SHARED';
  const isOwner = realm.role === 'OWNER';

  return (
    <div className="mt-6 divide-y divide-border border-t border-border">
      <NameRow realm={realm} editable={shared && canManageRealm(realm.role)} />
      {!shared && (
        <p className="py-4 text-sm text-foreground-muted">
          This is your personal Realm. Only you build here.
        </p>
      )}
      {shared && isOwner && <TransferRow realmId={realm.id} />}
      {shared && isOwner && <DeleteRow realm={realm} onGone={onGone} />}
    </div>
  );
}

function Row({
  title,
  copy,
  error,
  children,
}: {
  title: string;
  copy?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="py-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {copy && <p className="mt-0.5 text-xs text-foreground-muted">{copy}</p>}
        </div>
        {children}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

function NameRow({ realm, editable }: { realm: CurrentRealm; editable: boolean }) {
  const utils = trpc.useUtils();
  const rename = trpc.realms.rename.useMutation(inlineError);
  const [name, setName] = useState(realm.name);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  if (!editable) {
    return (
      <Row title="Name">
        <span className="truncate text-sm text-foreground-secondary">{realm.name}</span>
      </Row>
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || trimmed === realm.name) return;
    setError(null);
    try {
      await rename.mutateAsync({ realmId: realm.id, name: trimmed });
      await utils.realms.list.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the Realm.');
    }
  }

  return (
    <form onSubmit={save} className="py-4">
      <label htmlFor="realm-settings-name" className="text-sm font-medium text-foreground">
        Name
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id="realm-settings-name"
          autoComplete="off"
          maxLength={100}
          value={name}
          error={error !== null}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!trimmed || trimmed === realm.name || rename.isPending}
        >
          {rename.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}
    </form>
  );
}

function TransferRow({ realmId }: { realmId: string }) {
  const utils = trpc.useUtils();
  const membersQuery = trpc.realms.listMembers.useQuery({ realmId });
  const transfer = trpc.realms.transferOwnership.useMutation(inlineError);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const others = (membersQuery.data ?? []).filter((member) => member.role !== 'OWNER');
  const nameOf = (userId: string) => {
    const member = others.find((candidate) => candidate.userId === userId);
    return member ? (member.user.name ?? member.user.email) : '';
  };

  async function submit() {
    if (!newOwnerId) return;
    if (!window.confirm(`Make ${nameOf(newOwnerId)} the owner? You'll become an admin.`)) return;
    setError(null);
    try {
      await transfer.mutateAsync({ realmId, newOwnerId });
      // Your role changed, so everything that reads it refreshes.
      await Promise.all([utils.realms.list.invalidate(), utils.realms.listMembers.invalidate()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transfer ownership.');
    }
  }

  return (
    <Row
      title="Transfer ownership"
      copy={others.length ? "You'll become an admin." : 'Invite someone first.'}
      error={error}
    >
      <Select value={newOwnerId} onValueChange={setNewOwnerId} disabled={!others.length}>
        <SelectTrigger aria-label="New owner" className="h-9 w-36 text-sm">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {others.map((member) => (
            <SelectItem key={member.userId} value={member.userId}>
              {member.user.name ?? member.user.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        disabled={!newOwnerId || transfer.isPending}
        onClick={submit}
      >
        {transfer.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Transfer
      </Button>
    </Row>
  );
}

function DeleteRow({ realm, onGone }: { realm: CurrentRealm; onGone: () => void }) {
  const utils = trpc.useUtils();
  const remove = trpc.realms.delete.useMutation(inlineError);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!window.confirm(`Delete ${realm.name} for everyone? This can't be undone.`)) return;
    setError(null);
    try {
      await remove.mutateAsync({ realmId: realm.id });
      await utils.realms.list.invalidate();
      onGone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the Realm.');
    }
  }

  return (
    <Row title="Delete Realm" copy="Only once every project in it is gone." error={error}>
      <Button
        variant="outline"
        size="sm"
        className="text-error hover:text-error"
        disabled={remove.isPending}
        onClick={submit}
      >
        {remove.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Delete
      </Button>
    </Row>
  );
}
