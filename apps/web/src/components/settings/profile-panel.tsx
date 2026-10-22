'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@app-builder/ui/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GITHUB_MARK, GOOGLE_MARK, ProviderMark } from '@/components/landing/provider-logos';
import { AvatarCropDialog } from '@/components/settings/avatar-crop-dialog';
import type { inferRouterOutputs } from '@trpc/server';
import { trpc } from '@/lib/trpc/client';
import type { AppRouter } from '@/lib/trpc/root';

/* ── Shared ──────────────────────────────────────────────── */

type Account = inferRouterOutputs<AppRouter>['account']['get'];
type ProviderId = Account['providers'][number]['id'];

const PROVIDERS: Record<ProviderId, { name: string; mark: string }> = {
  google: { name: 'Google', mark: GOOGLE_MARK },
  github: { name: 'GitHub', mark: GITHUB_MARK },
};

/** Redirect codes from the "connect a provider" round trip (lib/auth.ts). */
const LINK_ERRORS: Record<string, string> = {
  taken: 'That account is already connected to a different Sovereign account.',
  exists: 'You already have one of those connected. Disconnect it first to use another.',
};

const errorText = (err: unknown, fallback = "That didn't work. Try again.") =>
  err instanceof Error && err.message ? err.message : fallback;

/** Mutations whose errors the panel shows inline, not as a toast. */
const inline = { meta: { inlineError: true } };

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Up to two initials: "Ada Lovelace" -> "AL", "ada@x.dev" -> "A". */
function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0] ?? 'U';
  const last = words.at(-1) ?? '';
  if (name.includes('@') || words.length < 2) return first.charAt(0).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const id = `profile-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className={className}>
      <h2 id={id} className="text-[15px] font-semibold text-foreground">
        {title}
      </h2>
      <ul className="mt-3 divide-y divide-border border-y border-border">{children}</ul>
    </section>
  );
}

function Row({
  label,
  value,
  leading,
  action,
}: {
  label: ReactNode;
  value?: ReactNode;
  leading?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex min-h-16 items-center gap-3 py-3">
      {leading}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {value && <div className="mt-0.5 text-sm text-foreground-muted">{value}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </li>
  );
}

function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-error">
      {children}
    </p>
  );
}

function Spinner() {
  return <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />;
}

/* ── Panel ───────────────────────────────────────────────── */

export function ProfilePanel() {
  const accountQuery = trpc.account.get.useQuery();
  const { update: updateSession } = useSession();
  const utils = trpc.useUtils();

  // Results of the OAuth "connect" round trip arrive as query params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('linked') as ProviderId | null;
    const linkError = params.get('linkError');
    if (!linked && !linkError) return;
    if (linked && PROVIDERS[linked]) toast.success(`${PROVIDERS[linked].name} connected.`);
    if (linkError) toast.error(LINK_ERRORS[linkError] ?? "That account couldn't be connected.");
    params.delete('linked');
    params.delete('linkError');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);

  if (accountQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
      </div>
    );
  }
  if (!accountQuery.data) {
    return (
      <div className="max-w-[640px] py-6 text-sm text-foreground-secondary">
        <p>Your profile didn&apos;t load.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => accountQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const account = accountQuery.data;
  // Name, email and avatar also live in the session token the sidebar reads.
  const refresh = async (opts?: { session?: boolean }) => {
    await utils.account.get.invalidate();
    if (opts?.session) await updateSession();
  };

  return (
    <div className="max-w-[640px] space-y-10">
      <Section title="Profile">
        <AvatarRow account={account} onChanged={() => refresh({ session: true })} />
        <NameRow account={account} onChanged={() => refresh({ session: true })} />
        <EmailRow account={account} onChanged={() => refresh()} />
      </Section>

      <Section title="Sign-in">
        {account.providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            account={account}
            onChanged={() => refresh()}
          />
        ))}
        {account.hasPassword && <PasswordRow email={account.email} />}
        <SignOutEverywhereRow />
      </Section>

      <Section title="Preferences">
        <MascotRow enabled={account.mascotAnimations} />
      </Section>

      <Section title="Danger zone" className="!mt-16">
        <ExportRow />
        <DeleteAccountRow email={account.email} hasPassword={account.hasPassword} />
      </Section>
    </div>
  );
}

/* ── Profile ─────────────────────────────────────────────── */

function AvatarRow({ account, onChanged }: { account: Account; onChanged: () => Promise<void> }) {
  const setAvatar = trpc.account.setAvatar.useMutation(inline);
  const removeAvatar = trpc.account.removeAvatar.useMutation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file, like a PNG or JPEG.');
    } else if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is over 10 MB. Pick a smaller one.');
    } else {
      setPicked(file);
    }
  };

  const save = async (image: string) => {
    try {
      await setAvatar.mutateAsync({ image });
    } catch (err) {
      throw new Error(errorText(err, "Your photo didn't save. Try again."));
    }
    await onChanged();
    setPicked(null);
  };

  const remove = async () => {
    await removeAvatar.mutateAsync();
    await onChanged();
  };

  const displayName = account.name || account.email;

  return (
    <Row
      leading={
        <Avatar className="h-10 w-10">
          {account.avatarUrl ? <AvatarImage src={account.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(displayName)}</AvatarFallback>
        </Avatar>
      }
      label="Avatar"
      value={
        error ? (
          <FieldError>{error}</FieldError>
        ) : account.avatarUrl ? (
          'Shown next to your name.'
        ) : (
          'Using your initials.'
        )
      }
      action={
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              pick(event.target.files?.[0]);
              // Let the same file be picked again after a cancel.
              event.target.value = '';
            }}
          />
          {account.avatarUrl && (
            <Button variant="ghost" size="sm" disabled={removeAvatar.isPending} onClick={remove}>
              {removeAvatar.isPending && <Spinner />}
              Remove
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
            Change
          </Button>
          <AvatarCropDialog file={picked} onClose={() => setPicked(null)} onSave={save} />
        </>
      }
    />
  );
}

function NameRow({ account, onChanged }: { account: Account; onChanged: () => Promise<void> }) {
  const updateName = trpc.account.updateName.useMutation(inline);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setName(account.name ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name.');
    if (trimmed.length > 100) return setError('Keep your name under 100 characters.');
    if (trimmed === account.name) return setEditing(false);
    setError(null);
    try {
      await updateName.mutateAsync({ name: trimmed });
      await onChanged();
      setEditing(false);
    } catch (err) {
      setError(errorText(err, "Your name didn't save. Try again."));
    }
  };

  if (editing) {
    return (
      <li className="py-3">
        <form onSubmit={save} className="space-y-2">
          <label htmlFor="profile-name" className="text-sm font-medium text-foreground">
            Name
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="profile-name"
              autoFocus
              autoComplete="name"
              maxLength={100}
              value={name}
              error={error !== null}
              aria-describedby={error ? 'profile-name-error' : undefined}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
              className="h-9 sm:flex-1"
            />
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="outline" size="sm" disabled={updateName.isPending}>
                {updateName.isPending && <Spinner />}
                Save
              </Button>
            </div>
          </div>
          {error && <FieldError id="profile-name-error">{error}</FieldError>}
        </form>
      </li>
    );
  }

  return (
    <Row
      label="Name"
      value={account.name ?? 'Not set'}
      action={
        <Button variant="ghost" size="sm" onClick={start}>
          Edit
        </Button>
      }
    />
  );
}

function EmailRow({ account, onChanged }: { account: Account; onChanged: () => Promise<void> }) {
  const cancelChange = trpc.account.cancelEmailChange.useMutation();
  const [open, setOpen] = useState(false);

  const cancel = async () => {
    await cancelChange.mutateAsync();
    await onChanged();
  };

  return (
    <Row
      label="Email"
      value={
        <>
          <span className="block truncate text-foreground-secondary">{account.email}</span>
          {account.pendingEmail && (
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
              <span className="min-w-0 truncate">
                Pending confirmation:{' '}
                <span className="text-foreground-secondary">{account.pendingEmail}</span>
              </span>
              <button
                type="button"
                onClick={cancel}
                disabled={cancelChange.isPending}
                className="rounded-item text-foreground-secondary underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40 disabled:opacity-45"
              >
                Cancel change
              </button>
            </span>
          )}
        </>
      }
      action={
        <>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              {open && (
                <EmailForm
                  account={account}
                  onDone={async () => {
                    await onChanged();
                    setOpen(false);
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        </>
      }
    />
  );
}

function EmailForm({ account, onDone }: { account: Account; onDone: () => Promise<void> }) {
  const requestChange = trpc.account.requestEmailChange.useMutation(inline);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return setError('Enter a valid email address.');
    if (account.hasPassword && !password) return setError('Enter your password to confirm.');
    setError(null);
    try {
      const result = await requestChange.mutateAsync({
        email: next,
        password: account.hasPassword ? password : undefined,
      });
      toast.success(`Check ${result.pendingEmail} for a confirmation link.`);
      await onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    // noValidate: show our wording instead of the browser's email tooltip.
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>Change email</DialogTitle>
        <DialogDescription>
          We&apos;ll send a link to the new address. {account.email} keeps working until you open
          it.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-6">
        <div className="space-y-2">
          <label htmlFor="new-email" className="text-sm font-medium text-foreground">
            New email
          </label>
          <Input
            id="new-email"
            type="email"
            autoFocus
            autoComplete="email"
            value={email}
            error={error !== null}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {account.hasPassword && (
          <div className="space-y-2">
            <label htmlFor="email-password" className="text-sm font-medium text-foreground">
              Current password
            </label>
            <Input
              id="email-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={requestChange.isPending}>
          {requestChange.isPending && <Spinner />}
          Send link
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ── Sign-in ─────────────────────────────────────────────── */

function ProviderRow({
  provider,
  account,
  onChanged,
}: {
  provider: Account['providers'][number];
  account: Account;
  onChanged: () => Promise<void>;
}) {
  const beginConnect = trpc.account.beginConnect.useMutation();
  const disconnect = trpc.account.disconnectProvider.useMutation();
  const [redirecting, setRedirecting] = useState(false);
  const { name, mark } = PROVIDERS[provider.id];

  const methods =
    account.providers.filter((p) => p.connected).length + (account.hasPassword ? 1 : 0);
  const isLastMethod = provider.connected && methods <= 1;

  const connect = async () => {
    setRedirecting(true);
    try {
      await beginConnect.mutateAsync({ provider: provider.id });
      // The callback sends the browser back here with ?linked= or ?linkError=.
      await signIn(provider.id, { callbackUrl: '/settings?tab=profile' });
    } catch {
      setRedirecting(false);
    }
  };

  const remove = async () => {
    await disconnect.mutateAsync({ provider: provider.id });
    toast.success(`${name} disconnected.`);
    await onChanged();
  };

  return (
    <Row
      leading={<ProviderMark d={mark} className="h-[18px] w-[18px] text-foreground" />}
      label={name}
      value={
        provider.connected ? (
          <span className="flex items-center gap-1.5 text-xs">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
            {isLastMethod ? 'Connected · your only way to sign in' : 'Connected'}
          </span>
        ) : (
          <span className="text-xs">Not connected</span>
        )
      }
      action={
        provider.connected ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isLastMethod || disconnect.isPending}
            title={isLastMethod ? 'Connect another way to sign in first.' : undefined}
            onClick={remove}
          >
            {disconnect.isPending && <Spinner />}
            Disconnect
          </Button>
        ) : (
          provider.enabled && (
            <Button variant="outline" size="sm" disabled={redirecting} onClick={connect}>
              {redirecting && <Spinner />}
              Connect
            </Button>
          )
        )
      }
    />
  );
}

function PasswordRow({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Row
      label="Password"
      value="Signing in with your email also works."
      action={
        <>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Change password
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              {open && <PasswordForm email={email} onDone={() => setOpen(false)} />}
            </DialogContent>
          </Dialog>
        </>
      }
    />
  );
}

function PasswordForm({ email, onDone }: { email: string; onDone: () => void }) {
  const changePassword = trpc.account.changePassword.useMutation(inline);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return setError('Enter your current password.');
    if (next.length < 8) return setError('Use at least 8 characters for the new password.');
    if (next !== confirm) return setError("The new passwords don't match.");
    setError(null);
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next });
    } catch (err) {
      return setError(errorText(err));
    }
    // Every session was just signed out, this one included: sign back in
    // with the new password so the user stays put.
    setSigningIn(true);
    const result = await signIn('credentials', { email, password: next, redirect: false });
    if (!result?.ok) {
      window.location.href = '/auth/signin?callbackUrl=%2Fsettings%3Ftab%3Dprofile';
      return;
    }
    toast.success('Password changed. Your other devices were signed out.');
    onDone();
  };

  const busy = changePassword.isPending || signingIn;

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Change password</DialogTitle>
        <DialogDescription>This signs you out on every other device.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-6">
        <div className="space-y-2">
          <label htmlFor="current-password" className="text-sm font-medium text-foreground">
            Current password
          </label>
          <Input
            id="current-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="new-password" className="text-sm font-medium text-foreground">
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
            Confirm new password
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
        {error && <FieldError>{error}</FieldError>}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          Change password
        </Button>
      </DialogFooter>
    </form>
  );
}

function SignOutEverywhereRow() {
  const signOutEverywhere = trpc.account.signOutEverywhere.useMutation();
  const [open, setOpen] = useState(false);

  const confirm = async () => {
    await signOutEverywhere.mutateAsync();
    await signOut({ callbackUrl: '/auth/signin' });
  };

  return (
    <Row
      label="Sessions"
      value="Signed in somewhere you don't recognise? End every session."
      action={
        <>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Sign out of all devices
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Sign out of all devices?</DialogTitle>
                <DialogDescription>
                  Every session ends, including this one. You&apos;ll need to sign in again.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button disabled={signOutEverywhere.isPending} onClick={confirm}>
                  {signOutEverywhere.isPending && <Spinner />}
                  Sign out everywhere
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    />
  );
}

/* ── Preferences ─────────────────────────────────────────── */

function MascotRow({ enabled }: { enabled: boolean }) {
  const utils = trpc.useUtils();
  const update = trpc.account.updatePreferences.useMutation({
    // Optimistic: the switch and every mascot on screen react at once.
    onMutate: ({ mascotAnimations }) => {
      utils.account.preferences.setData(undefined, { mascotAnimations });
      utils.account.get.setData(undefined, (old) => old && { ...old, mascotAnimations });
    },
    onError: () => {
      utils.account.preferences.setData(undefined, { mascotAnimations: enabled });
      utils.account.get.setData(undefined, (old) => old && { ...old, mascotAnimations: enabled });
    },
  });

  return (
    <Row
      label={<label htmlFor="mascot-animations">Mascot animations</label>}
      value="Sovereign moves while it works. Off keeps it still, apart from blinking."
      action={
        <Switch
          id="mascot-animations"
          checked={enabled}
          onCheckedChange={(mascotAnimations) => update.mutate({ mascotAnimations })}
        />
      }
    />
  );
}

/* ── Danger zone ─────────────────────────────────────────── */

function ExportRow() {
  const [exporting, setExporting] = useState(false);

  const download = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/account/export');
      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? 'You exported recently. Try again in an hour.'
            : "Your export didn't finish. Try again.",
        );
      }
      const blob = await response.blob();
      const name =
        /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ??
        'sovereign-export.zip';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorText(err, "Your export didn't finish. Try again."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Row
      label="Export my data"
      value="Projects, settings and account info as a .zip. API keys are never included."
      action={
        <Button variant="secondary" size="sm" disabled={exporting} onClick={download}>
          {exporting && <Spinner />}
          {exporting ? 'Preparing' : 'Export'}
        </Button>
      }
    />
  );
}

function DeleteAccountRow({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Row
      label="Delete account"
      value="Permanently delete your account and everything in it."
      action={
        <>
          <Button
            variant="outline"
            size="sm"
            className="border-error text-error hover:bg-error-light hover:text-error"
            onClick={() => setOpen(true)}
          >
            Delete account
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              {open && <DeleteAccountForm email={email} hasPassword={hasPassword} />}
            </DialogContent>
          </Dialog>
        </>
      }
    />
  );
}

function DeleteAccountForm({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  const summary = trpc.account.deletionSummary.useQuery();
  const deleteAccount = trpc.account.deleteAccount.useMutation(inline);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  const confirmed = matches && (!hasPassword || password.length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    setError(null);
    try {
      await deleteAccount.mutateAsync({
        email: typed.trim(),
        password: hasPassword ? password : undefined,
      });
    } catch (err) {
      return setError(errorText(err));
    }
    await signOut({ callbackUrl: '/' });
  };

  const counts = summary.data;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogDescription>
          This can&apos;t be undone. Export your data first if you want a copy.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-6">
        <div className="text-sm text-foreground-secondary">
          <p>We&apos;ll permanently delete:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              {counts ? plural(counts.projects, 'project', 'projects') : 'Your projects'}, with
              their files, chats and app databases
            </li>
            <li>
              {counts ? plural(counts.liveApps, 'deployed app', 'deployed apps') : 'Deployed apps'},
              taken offline
            </li>
            <li>
              {counts ? plural(counts.apiKeys, 'stored API key', 'stored API keys') : 'Stored keys'}
            </li>
            <li>Your profile, sign-in methods and personal workspace</li>
          </ul>
        </div>
        <div className="space-y-2">
          <label htmlFor="delete-confirm" className="text-sm text-foreground-secondary">
            Type <span className="font-medium text-foreground">{email}</span> to confirm
          </label>
          <Input
            id="delete-confirm"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            value={typed}
            error={error !== null}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        {hasPassword && (
          <div className="space-y-2">
            <label htmlFor="delete-password" className="text-sm text-foreground-secondary">
              Confirm with your password
            </label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              error={error !== null}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant="destructive"
          disabled={!confirmed || deleteAccount.isPending}
          className={cn(deleteAccount.isPending && 'cursor-wait')}
        >
          {deleteAccount.isPending && <Spinner />}
          Delete account
        </Button>
      </DialogFooter>
    </form>
  );
}
