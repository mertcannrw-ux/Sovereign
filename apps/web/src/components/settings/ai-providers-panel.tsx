'use client';

import { useState, type FormEvent } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Logo } from '@/components/Logo';
import { PROVIDER_LOGOS, ProviderMark } from '@/components/landing/provider-logos';
import { cn } from '@app-builder/ui/utils';
import { trpc } from '@/lib/trpc/client';
import { canManageRealm, useCurrentRealm } from '@/lib/use-current-realm';
import type { RealmRole } from '@app-builder/shared';

/* ── Providers ───────────────────────────────────────────── */

type ProviderId = 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq' | 'ollama' | 'custom';

interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Where the user gets a key (or, for Ollama, the server). */
  keyUrl: string;
}

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'mistral', name: 'Mistral', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'groq', name: 'Groq', keyUrl: 'https://console.groq.com/keys' },
  { id: 'ollama', name: 'Ollama', keyUrl: 'https://ollama.com/download' },
  { id: 'custom', name: 'Custom (OpenAI compatible)', keyUrl: '' },
];

const markFor = (name: string) => PROVIDER_LOGOS.find((logo) => logo.name === name)?.d;

type RowStatus =
  | { kind: 'disconnected' }
  | { kind: 'checking' }
  | { kind: 'connected'; models: number }
  | { kind: 'error' };

/* ── Panel ───────────────────────────────────────────────── */

export function AIProvidersPanel() {
  const { realm } = useCurrentRealm();
  if (!realm) {
    return <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />;
  }
  // Keyed so switching Realms drops the previous Realm's open dialogs.
  return <RealmProviders key={realm.id} realmId={realm.id} role={realm.role} />;
}

const INTRO: Record<RealmRole, string> = {
  OWNER:
    'Everyone in this Realm builds with these keys. They are encrypted and only sent to the provider.',
  ADMIN:
    'Everyone in this Realm builds with these keys. You can change the ones you add; the owner can change any.',
  MEMBER: 'Everyone in this Realm builds with these keys. Only owners and admins can add them.',
};

/**
 * The current Realm's keys. Everyone sees what is connected and who added it;
 * Owner/Admin add keys, and a key is changed only by its adder or the Owner.
 */
function RealmProviders({ realmId, role }: { realmId: string; role: RealmRole }) {
  const canManage = canManageRealm(role);
  const utils = trpc.useUtils();
  const keysQuery = trpc.apiKeys.list.useQuery({ realmId });
  const modelsQuery = trpc.apiKeys.listModels.useQuery(
    { realmId },
    { enabled: keysQuery.isSuccess },
  );
  const [connecting, setConnecting] = useState<ProviderInfo | null>(null);
  const [managing, setManaging] = useState<ProviderInfo | null>(null);

  const keys = keysQuery.data ?? [];
  // `list` is newest first, so this is the key the builder uses.
  const keyFor = (provider: ProviderId) => keys.find((key) => key.provider === provider);

  const statusFor = (provider: ProviderId): RowStatus => {
    const key = keyFor(provider);
    if (!key) return { kind: 'disconnected' };
    const group = modelsQuery.data?.find((entry) => entry.id === key.id);
    if (!group) return { kind: 'checking' };
    if (group.error) return { kind: 'error' };
    return { kind: 'connected', models: group.models.length };
  };

  const refresh = () => utils.apiKeys.invalidate();

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">AI providers</h2>
        <p className="mt-2 text-sm text-foreground-muted">{INTRO[role]}</p>

        {keysQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
          </div>
        ) : (
          <>
            {keys.length === 0 && (
              <p className="mt-6 flex items-center gap-2.5 text-sm text-foreground-secondary">
                <Logo size={20} state="idle" />
                {canManage
                  ? 'I need a key first. Connect one below.'
                  : 'I need a key first. Ask an owner or admin to connect one.'}
              </p>
            )}
            <ul className="mt-6 divide-y divide-border rounded-card border border-border">
              {PROVIDERS.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  apiKey={keyFor(provider.id)}
                  status={statusFor(provider.id)}
                  canAdd={canManage}
                  onConnect={() => setConnecting(provider)}
                  onManage={() => setManaging(provider)}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <ImageGenerationSection realmId={realmId} canManage={canManage} />

      <ConnectDialog
        realmId={realmId}
        provider={connecting}
        existing={connecting ? keyFor(connecting.id) : undefined}
        onClose={() => setConnecting(null)}
        onConnected={refresh}
      />
      <ManageDialog
        realmId={realmId}
        provider={managing}
        apiKey={managing ? keyFor(managing.id) : undefined}
        status={managing ? statusFor(managing.id) : { kind: 'disconnected' }}
        onClose={() => setManaging(null)}
        onReplace={() => {
          setConnecting(managing);
          setManaging(null);
        }}
        onRemoved={refresh}
      />
    </div>
  );
}

/* ── Row ─────────────────────────────────────────────────── */

/** Who added a key, for everyone in the Realm: their account is the one builds use. */
function addedByLabel(key: { addedBy: string; addedByYou: boolean }): string {
  return `Added by ${key.addedByYou ? 'you' : key.addedBy}`;
}

function ProviderRow({
  provider,
  apiKey,
  status,
  canAdd,
  onConnect,
  onManage,
}: {
  provider: ProviderInfo;
  apiKey?: { addedBy: string; addedByYou: boolean; canManage: boolean };
  status: RowStatus;
  /** Owner/Admin may connect a provider nobody has connected yet. */
  canAdd: boolean;
  onConnect: () => void;
  onManage: () => void;
}) {
  const mark = markFor(provider.name);
  // A connected key is changed only by whoever added it, or the Owner.
  const actionable = apiKey ? apiKey.canManage : canAdd;

  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-5">
      {mark && <ProviderMark d={mark} className="h-[18px] w-[18px] text-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{provider.name}</p>
        <StatusLine
          status={status}
          isOllama={provider.id === 'ollama'}
          addedBy={apiKey && addedByLabel(apiKey)}
        />
      </div>
      {actionable && <RowAction status={status} onConnect={onConnect} onManage={onManage} />}
    </li>
  );
}

function RowAction({
  status,
  onConnect,
  onManage,
}: {
  status: RowStatus;
  onConnect: () => void;
  onManage: () => void;
}) {
  return (
    <>
      {status.kind === 'disconnected' && (
        <Button variant="outline" size="sm" onClick={onConnect}>
          Connect
        </Button>
      )}
      {status.kind === 'error' && (
        <Button variant="outline" size="sm" onClick={onConnect}>
          Fix
        </Button>
      )}
      {(status.kind === 'connected' || status.kind === 'checking') && (
        <Button variant="ghost" size="sm" onClick={onManage}>
          Manage
        </Button>
      )}
    </>
  );
}

function StatusLine({
  status,
  isOllama,
  addedBy,
}: {
  status: RowStatus;
  isOllama: boolean;
  addedBy?: string;
}) {
  const base = 'mt-0.5 flex items-center gap-1.5 text-xs text-foreground-muted';
  const by = addedBy ? ` · ${addedBy}` : '';
  switch (status.kind) {
    case 'disconnected':
      return <p className={base}>Not connected</p>;
    case 'checking':
      return (
        <p className={base}>
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          Checking connection{by}
        </p>
      );
    case 'connected':
      return (
        <p className={base}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
          Connected · {status.models} {status.models === 1 ? 'model' : 'models'}
          {by}
        </p>
      );
    case 'error':
      return (
        <p className={base}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-error" />
          {isOllama ? 'Server unreachable' : 'Key invalid'}
          {by}
        </p>
      );
  }
}

/* ── Connect ─────────────────────────────────────────────── */

function ConnectDialog({
  realmId,
  provider,
  existing,
  onClose,
  onConnected,
}: {
  realmId: string;
  provider: ProviderInfo | null;
  existing?: { label: string | null; baseUrl: string | null };
  onClose: () => void;
  onConnected: () => void;
}) {
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {provider && (
          // Keyed so each open starts from a clean form.
          <ConnectForm
            key={provider.id}
            realmId={realmId}
            provider={provider}
            existing={existing}
            onDone={() => {
              onConnected();
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectForm({
  realmId,
  provider,
  existing,
  onDone,
}: {
  realmId: string;
  provider: ProviderInfo;
  existing?: { label: string | null; baseUrl: string | null };
  onDone: () => void;
}) {
  const saveMutation = trpc.apiKeys.save.useMutation();
  const isOllama = provider.id === 'ollama';
  const needsKey = !isOllama;
  const needsUrl = isOllama || provider.id === 'custom';
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? (isOllama ? OLLAMA_DEFAULT_URL : ''));
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    (!needsKey || apiKey.trim().length > 0) &&
    (!needsUrl || baseUrl.trim().length > 0) &&
    !saveMutation.isPending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      await saveMutation.mutateAsync({
        realmId,
        provider: provider.id,
        key: needsKey ? apiKey.trim() : undefined,
        // Keep the existing label so replacing a key updates it instead of adding a second one.
        label: existing?.label ?? undefined,
        baseUrl: needsUrl ? baseUrl.trim() : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    }
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Connect {provider.name}</DialogTitle>
        {isOllama && (
          <DialogDescription>Ollama runs on your machine and needs no key.</DialogDescription>
        )}
      </DialogHeader>

      <div className="space-y-4 py-6">
        {needsUrl && (
          <div className="space-y-2">
            <label htmlFor="provider-url" className="text-sm font-medium text-foreground">
              Server URL
            </label>
            <Input
              id="provider-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              autoFocus={isOllama}
              placeholder={isOllama ? OLLAMA_DEFAULT_URL : 'https://api.example.com/v1'}
              value={baseUrl}
              error={isOllama && error !== null}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
        )}
        {needsKey && (
          <div className="space-y-2">
            <label htmlFor="provider-key" className="text-sm font-medium text-foreground">
              API key
            </label>
            <Input
              id="provider-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus={!needsUrl}
              value={apiKey}
              error={error !== null}
              aria-describedby={error ? 'provider-error' : undefined}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
        )}
        {error && (
          <p id="provider-error" role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {provider.keyUrl && (
          <a
            href={provider.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-item text-sm text-foreground-secondary underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
          >
            {isOllama ? "Don't have Ollama yet?" : 'Where do I get a key?'}
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSubmit}>
          {saveMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Connect
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ── Manage ──────────────────────────────────────────────── */

function ManageDialog({
  realmId,
  provider,
  apiKey,
  status,
  onClose,
  onReplace,
  onRemoved,
}: {
  realmId: string;
  provider: ProviderInfo | null;
  apiKey?: { id: string; maskedKey: string | null; baseUrl: string | null };
  status: RowStatus;
  onClose: () => void;
  onReplace: () => void;
  onRemoved: () => void;
}) {
  const deleteMutation = trpc.apiKeys.delete.useMutation();
  const [confirming, setConfirming] = useState(false);
  const isOllama = provider?.id === 'ollama';

  const close = () => {
    setConfirming(false);
    onClose();
  };

  const remove = async () => {
    if (!apiKey) return;
    await deleteMutation.mutateAsync({ realmId, id: apiKey.id });
    onRemoved();
    close();
  };

  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirming ? `Remove ${provider?.name}?` : provider?.name}</DialogTitle>
          <DialogDescription>
            {confirming
              ? 'The key is deleted and its models disappear from the builder. You can connect again any time.'
              : status.kind === 'connected'
                ? `Connected · ${status.models} ${status.models === 1 ? 'model' : 'models'}`
                : 'Checking connection'}
          </DialogDescription>
        </DialogHeader>

        {!confirming && apiKey && (
          <dl className="my-6 divide-y divide-border rounded-control border border-border text-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-foreground-muted">{isOllama ? 'Server URL' : 'API key'}</dt>
              <dd className="truncate font-mono text-foreground">
                {isOllama ? (apiKey.baseUrl ?? OLLAMA_DEFAULT_URL) : (apiKey.maskedKey ?? '****')}
              </dd>
            </div>
          </dl>
        )}

        <DialogFooter className={cn(confirming && 'mt-6', 'sm:items-center')}>
          {confirming ? (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={deleteMutation.isPending} onClick={remove}>
                {deleteMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Remove
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="text-error hover:text-error sm:mr-auto"
                onClick={() => setConfirming(true)}
              >
                Remove
              </Button>
              <Button variant="outline" onClick={onReplace}>
                {isOllama ? 'Change URL' : 'Replace key'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Image generation ────────────────────────────────────── */

function ImageGenerationSection({ realmId, canManage }: { realmId: string; canManage: boolean }) {
  const configQuery = trpc.imageProvider.get.useQuery({ realmId });
  const saveMutation = trpc.imageProvider.save.useMutation();
  const testMutation = trpc.imageProvider.test.useMutation();
  const deleteMutation = trpc.imageProvider.delete.useMutation();
  const config = configQuery.data;

  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const openDialog = () => {
    setEndpoint(config?.baseUrl ?? '');
    setModel(config?.model ?? '');
    setKey('');
    setResult(null);
    setOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    try {
      await saveMutation.mutateAsync({
        realmId,
        baseUrl: endpoint,
        apiKey: key || undefined,
        model,
      });
      await configQuery.refetch();
      setOpen(false);
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : "That didn't save. Try again.",
      });
    }
  };

  const test = async () => {
    setResult(null);
    try {
      setResult(await testMutation.mutateAsync({ realmId }));
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'The endpoint test failed.',
      });
    }
  };

  const remove = async () => {
    if (!config) return;
    await deleteMutation.mutateAsync({ realmId, id: config.id });
    await configQuery.refetch();
    setOpen(false);
  };

  return (
    <section>
      <h3 className="text-base font-semibold text-foreground">Image generation</h3>
      <p className="mt-1 text-sm text-foreground-muted">
        Optional. Any OpenAI-compatible image endpoint.
      </p>
      <div className="mt-4 flex min-h-16 items-center gap-3 rounded-card border border-border px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Image provider</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-foreground-muted">
            {config ? (
              <>
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                Configured · {config.model} · {addedByLabel(config)}
              </>
            ) : (
              'Not configured'
            )}
          </p>
        </div>
        {/* Anyone who manages keys may set one up; only its adder or the Owner change it. */}
        {(config ? config.canManage : canManage) &&
          (config ? (
            <Button variant="ghost" size="sm" onClick={openDialog}>
              Manage
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={openDialog}>
              Set up
            </Button>
          ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Image provider</DialogTitle>
              <DialogDescription>
                Generated images are stored in Cloudflare R2, so the server needs R2 configured too.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-6">
              <div className="space-y-2">
                <label htmlFor="image-endpoint" className="text-sm font-medium text-foreground">
                  Endpoint URL
                </label>
                <Input
                  id="image-endpoint"
                  type="url"
                  spellCheck={false}
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="image-key" className="text-sm font-medium text-foreground">
                  API key
                </label>
                <Input
                  id="image-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={config ? 'Leave blank to keep the current key' : undefined}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="image-model" className="text-sm font-medium text-foreground">
                  Model
                </label>
                <Input
                  id="image-model"
                  spellCheck={false}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
              </div>
              {result && (
                <p
                  role={result.success ? 'status' : 'alert'}
                  className={cn('text-sm', result.success ? 'text-success' : 'text-error')}
                >
                  {result.message}
                </p>
              )}
            </div>
            <DialogFooter className="sm:items-center">
              {config && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-error hover:text-error sm:mr-auto"
                    disabled={deleteMutation.isPending}
                    onClick={remove}
                  >
                    Remove
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testMutation.isPending}
                    onClick={test}
                  >
                    {testMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Test
                  </Button>
                </>
              )}
              <Button
                type="submit"
                disabled={!endpoint.trim() || !model.trim() || saveMutation.isPending}
              >
                {saveMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
