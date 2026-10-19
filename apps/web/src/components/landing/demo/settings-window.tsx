'use client';

import { CircleUser, CodeXml, CreditCard, Loader2, Users } from 'lucide-react';
import { AIKey } from '@/components/ui/ai-key-icon';
import { cn } from '@app-builder/ui/utils';
import { Logo } from '@/components/Logo';
import { PROVIDER_LOGOS, ProviderMark } from '../provider-logos';
import { AppSidebar } from './app-sidebar';

/**
 * `app/settings/page.tsx` with `components/settings/ai-providers-panel.tsx`.
 * Real tab list, real provider roster and order, real status strings and the
 * real `Connect` / `Manage` affordances.
 */

const TABS = [
  { id: 'profile', label: 'Profile', Icon: CircleUser },
  { id: 'providers', label: 'AI Providers', Icon: AIKey },
  { id: 'teams', label: 'Team', Icon: Users },
  { id: 'billing', label: 'Billing', Icon: CreditCard },
  { id: 'developer-api', label: 'Developer API', Icon: CodeXml },
] as const;

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'google', name: 'Google Gemini' },
  { id: 'mistral', name: 'Mistral' },
  { id: 'groq', name: 'Groq' },
  { id: 'ollama', name: 'Ollama' },
  { id: 'custom', name: 'Custom (OpenAI compatible)' },
];

const markFor = (name: string) => PROVIDER_LOGOS.find((logo) => logo.name === name)?.d;

export function SettingsWindow({
  tab = 'providers',
  connected,
  typing,
}: {
  tab?: (typeof TABS)[number]['id'];
  /** provider id → model count, as `apiKeys.listModels` reports it. */
  connected?: Record<string, number>;
  /** Provider id whose key is being verified. */
  typing?: string | null;
}) {
  const noneConnected = !connected || Object.keys(connected).length === 0;

  return (
    <div className="flex h-full bg-background">
      <AppSidebar active="Settings" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-5 pt-4">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">Settings</h2>
        </div>

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-5 pt-2">
          {TABS.map(({ id, label, Icon }) => (
            <div
              key={id}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium',
                id === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-foreground-muted',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', id === tab && 'text-primary')} />
              {label}
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">AI providers</h3>
          <p className="mt-1 text-[13px] text-foreground-muted">
            Sovereign uses your own keys. They&apos;re encrypted and only sent to the provider.
          </p>

          {noneConnected && !typing && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-foreground-secondary">
              <Logo size={16} state="idle" />I need a key first. Connect one below.
            </p>
          )}

          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {PROVIDERS.map((provider) => {
              const models = connected?.[provider.id];
              const isTyping = typing === provider.id;
              const mark = markFor(provider.name);
              return (
                <li key={provider.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                  {mark && <ProviderMark d={mark} className="h-4 w-4 text-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {provider.name}
                    </p>
                    <p className="flex items-center gap-1.5 truncate text-[11px] text-foreground-muted">
                      {isTyping ? (
                        <>
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          Checking connection
                        </>
                      ) : models !== undefined ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          Connected · {models} models
                        </>
                      ) : (
                        'Not connected'
                      )}
                    </p>
                  </div>
                  {models !== undefined && !isTyping ? (
                    <span className="rounded-md px-2 py-1 text-[11px] font-semibold text-foreground-secondary">
                      Manage
                    </span>
                  ) : (
                    <span className="rounded-md border border-border-strong bg-background-subtle px-2 py-1 text-[11px] font-semibold text-foreground">
                      Connect
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
