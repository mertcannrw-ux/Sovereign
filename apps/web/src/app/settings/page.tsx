'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Key,
  User,
  Bot,
  Users,
  CreditCard,
  Plus,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@app-builder/ui/utils';
import { trpc } from '@/lib/trpc/client';

/* ── Types ───────────────────────────────────────────────── */

type ProviderId = 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq' | 'ollama' | 'custom';

interface ProviderInfo {
  id: ProviderId;
  name: string;
  icon: string;
  docsUrl: string;
  supportsBaseUrl: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'O',
    docsUrl: 'https://platform.openai.com/api-keys',
    supportsBaseUrl: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: 'A',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    supportsBaseUrl: false,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    icon: 'G',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    supportsBaseUrl: false,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    icon: 'M',
    docsUrl: 'https://console.mistral.ai/api-keys',
    supportsBaseUrl: false,
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: 'G',
    docsUrl: 'https://console.groq.com/keys',
    supportsBaseUrl: false,
  },
  { id: 'ollama', name: 'Ollama', icon: 'O', docsUrl: 'https://ollama.ai', supportsBaseUrl: true },
  {
    id: 'custom',
    name: 'Custom (OpenAI Compatible)',
    icon: '✦',
    docsUrl: '',
    supportsBaseUrl: true,
  },
];

/* ── Tab Navigation ───────────────────────────────────────── */

const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'providers', label: 'AI Providers (BYOK)', icon: Bot },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'api-keys', label: 'API Keys', icon: Key },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/* ── Page ────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('providers');

  if (status === 'loading')
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-foreground-muted" />
      </div>
    );
  if (!session) {
    router.push('/auth/signin');
    return null;
  }

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-9 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Account</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Settings</h1>
          <p className="mt-2 text-sm text-foreground-muted">Manage your identity, models, team, and subscription.</p>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8 md:flex-row md:gap-12">
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-2 md:w-56 md:flex-col md:overflow-visible" aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex h-11 shrink-0 items-center gap-3 rounded-lg px-3.5 text-left text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-background-muted text-foreground'
                  : 'text-foreground-muted hover:bg-background-subtle hover:text-foreground',
              )}
            >
              <tab.icon className={cn('h-4 w-4', activeTab === tab.id && 'text-primary')} />
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {activeTab === 'profile' && <Placeholder title="Profile" desc="Manage your account identity and personal preferences." />}
          {activeTab === 'providers' && <AIProvidersTab />}
          {activeTab === 'teams' && <Placeholder title="Teams" desc="Invite collaborators and manage workspace permissions." />}
          {activeTab === 'billing' && <Placeholder title="Billing" desc="Review your plan, invoices, and payment method." />}
          {activeTab === 'api-keys' && <Placeholder title="API Keys" desc="Create and revoke platform access credentials." />}
        </div>
      </div>
    </div>
  );
}

function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <Card className="border-border bg-background-subtle">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-foreground-muted">{desc}</p>
      </CardContent>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════
   AI Providers Tab
   ════════════════════════════════════════════════════════════ */

function AIProvidersTab() {
  const keysQuery = trpc.apiKeys.list.useQuery();
  const saveMutation = trpc.apiKeys.save.useMutation();
  const testMutation = trpc.apiKeys.test.useMutation();
  const deleteMutation = trpc.apiKeys.delete.useMutation();
  const [editingProvider, setEditingProvider] = useState<ProviderId | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: ProviderId;
    success: boolean;
    message: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ProviderId | null>(null);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});

  const keys = keysQuery.data ?? [];
  const getKeyForProvider = (provider: ProviderId) => keys.find((key) => key.provider === provider);

  const openAddDialog = (provider: ProviderId) => {
    const existing = getKeyForProvider(provider);
    setEditingProvider(provider);
    setEditKey('');
    setEditLabel(existing?.label ?? '');
    setEditBaseUrl(existing?.baseUrl ?? '');
    setTestResult(null);
  };

  const saveKey = async () => {
    if (!editingProvider || !editKey.trim()) return;

    try {
      const saved = await saveMutation.mutateAsync({
        provider: editingProvider,
        key: editKey.trim(),
        label: editLabel.trim() || undefined,
        baseUrl: editBaseUrl.trim() || undefined,
      });
      const result = await testMutation.mutateAsync({ id: saved.id });
      setProviderModels((previous) => ({
        ...previous,
        [editingProvider]: result.models,
      }));
      setTestResult({
        provider: editingProvider,
        success: true,
        message: `Connected. ${result.models.length} models available.`,
      });
      await keysQuery.refetch();
      setEditingProvider(null);
      setEditKey('');
      setEditLabel('');
      setEditBaseUrl('');
    } catch (error) {
      setTestResult({
        provider: editingProvider,
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save API key.',
      });
    }
  };

  const testConnection = async (provider: ProviderId) => {
    const key = getKeyForProvider(provider);
    if (!key) return;
    setTestingProvider(provider);
    setTestResult(null);

    try {
      const result = await testMutation.mutateAsync({ id: key.id });
      setProviderModels((previous) => ({ ...previous, [provider]: result.models }));
      setTestResult({
        provider,
        success: true,
        message: `Connected. ${result.models.length} models available.`,
      });
    } catch (error) {
      setTestResult({
        provider,
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed.',
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const confirmDelete = async (provider: ProviderId) => {
    const key = getKeyForProvider(provider);
    if (!key) return;
    await deleteMutation.mutateAsync({ id: key.id });
    setProviderModels((previous) => {
      const next = { ...previous };
      delete next[provider];
      return next;
    });
    setDeleteConfirm(null);
    await keysQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Model connections</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-foreground">AI providers</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-muted">
          Connect the providers you already use. Keys are encrypted, and model access is validated directly with each provider.
        </p>
      </div>
      <Separator />
      {keysQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <div className="grid gap-4">
          {PROVIDERS.map((provider) => {
            const key = getKeyForProvider(provider.id);
            const isTesting = testingProvider === provider.id;
            const result = testResult?.provider === provider.id ? testResult : null;
            const models = providerModels[provider.id] ?? [];

            return (
              <Card key={provider.id} className="border-border bg-background-subtle transition-colors hover:border-border-strong">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background-muted text-lg font-bold text-foreground">
                        {provider.icon}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-foreground">{provider.name}</h3>
                        <p className="text-xs text-foreground-muted">
                          {key ? `Configured · ${key.maskedKey}` : 'Not configured'}
                        </p>
                        {models.length > 0 && (
                          <p className="mt-0.5 max-w-[360px] truncate text-[10px] text-foreground-muted">
                            {models.slice(0, 6).join(', ')}
                            {models.length > 6 ? ` +${models.length - 6} more` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {key ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testConnection(provider.id)}
                            disabled={isTesting}
                          >
                            {isTesting ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Zap className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Refresh models
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openAddDialog(provider.id)}
                          >
                            Replace Key
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteConfirm(provider.id)}
                          >
                            <Trash2 className="h-4 w-4 text-error" />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => openAddDialog(provider.id)}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Key
                        </Button>
                      )}
                    </div>
                  </div>
                  {result && (
                    <div
                      className={cn(
                        'mt-3 rounded-md p-3 text-sm',
                        result.success ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {result.success ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        {result.message}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={editingProvider !== null}
        onOpenChange={(open) => {
          if (!open) setEditingProvider(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {getKeyForProvider(editingProvider ?? 'openai') ? 'Replace' : 'Add'}{' '}
              {editingProvider
                ? PROVIDERS.find((provider) => provider.id === editingProvider)?.name
                : ''}{' '}
              Key
            </DialogTitle>
            <DialogDescription>
              Saving verifies the key and loads the provider&apos;s current model list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">API Key</label>
              <Input
                type="password"
                autoComplete="off"
                placeholder="Enter provider API key"
                value={editKey}
                onChange={(event) => setEditKey(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Label (optional)</label>
              <Input
                placeholder="My key"
                value={editLabel}
                onChange={(event) => setEditLabel(event.target.value)}
              />
            </div>
            {editingProvider &&
              PROVIDERS.find((provider) => provider.id === editingProvider)?.supportsBaseUrl && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Base URL {editingProvider === 'custom' ? '(required)' : '(optional)'}
                  </label>
                  <Input
                    placeholder={
                      editingProvider === 'custom'
                        ? 'https://api.example.com/v1'
                        : 'Custom endpoint URL'
                    }
                    value={editBaseUrl}
                    onChange={(event) => setEditBaseUrl(event.target.value)}
                  />
                </div>
              )}
            {editingProvider &&
              PROVIDERS.find((provider) => provider.id === editingProvider)?.docsUrl && (
                <a
                  href={PROVIDERS.find((provider) => provider.id === editingProvider)?.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Get an API key <ExternalLink className="h-3 w-3" />
                </a>
              )}
            {testResult?.provider === editingProvider && !testResult.success && (
              <p className="rounded-md bg-error/10 p-3 text-sm text-error">{testResult.message}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={saveKey}
              disabled={!editKey.trim() || saveMutation.isPending || testMutation.isPending}
            >
              {(saveMutation.isPending || testMutation.isPending) && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Save and load models
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API Key</DialogTitle>
            <DialogDescription>
              This removes the encrypted key and its models from the builder.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteConfirm && confirmDelete(deleteConfirm)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
