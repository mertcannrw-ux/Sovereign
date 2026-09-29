'use client';

import { Bot, CreditCard, ExternalLink, Key, Plus, RefreshCw, User, Users } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { AppSidebar } from './app-sidebar';

/**
 * `app/settings/page.tsx`, AI Providers tab. Real tab list, real provider
 * roster (including the two OpenAI-compatible entries), real status strings
 * and the real `Add Key` / `Refresh models` affordances.
 */

const TABS = [
  { id: 'profile', label: 'Profile', Icon: User },
  { id: 'providers', label: 'AI Providers (BYOK)', Icon: Bot },
  { id: 'teams', label: 'Teams', Icon: Users },
  { id: 'billing', label: 'Billing', Icon: CreditCard },
  { id: 'api-keys', label: 'API Keys', Icon: Key },
] as const;

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', icon: 'O', docs: 'platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', icon: 'A', docs: 'console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Google Gemini', icon: 'G', docs: 'aistudio.google.com/app/apikey' },
  { id: 'mistral', name: 'Mistral', icon: 'M', docs: 'console.mistral.ai/api-keys' },
  { id: 'groq', name: 'Groq', icon: 'G', docs: 'console.groq.com/keys' },
  { id: 'ollama', name: 'Ollama', icon: 'O', docs: 'ollama.ai' },
  { id: 'custom', name: 'Custom (OpenAI Compatible)', icon: '✦', docs: '' },
];

export function SettingsWindow({
  tab = 'providers',
  connected,
  typing,
}: {
  tab?: (typeof TABS)[number]['id'];
  /** provider id → masked key suffix, as the settings query returns it. */
  connected?: Record<string, string>;
  /** Provider id whose key field is mid-entry. */
  typing?: string | null;
}) {
  return (
    <div className="flex h-full bg-background">
      <AppSidebar active="Settings" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-5 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-muted">
            Account
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
            Settings
          </h2>
        </div>

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-5">
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            Model connections
          </p>
          <h3 className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-foreground">
            AI providers
          </h3>
          <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-foreground-muted">
            Connect the providers you already use. Keys are encrypted, and model access is validated
            directly with each provider.
          </p>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {PROVIDERS.map((provider) => {
              const masked = connected?.[provider.id];
              const isTyping = typing === provider.id;
              return (
                <div
                  key={provider.id}
                  className={cn(
                    'rounded-xl border bg-background-subtle p-3 transition-all duration-500',
                    masked || isTyping
                      ? 'border-primary/35 shadow-[0_0_0_1px_rgba(184,255,90,0.12)]'
                      : 'border-border',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold transition-colors duration-500',
                        masked
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background-muted text-foreground-secondary',
                      )}
                    >
                      {provider.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-foreground">
                        {provider.name}
                      </p>
                      <p className="truncate text-[10px] text-foreground-muted">
                        {masked
                          ? `Configured · ${masked}`
                          : isTyping
                            ? 'Encrypting…'
                            : 'Not configured'}
                      </p>
                    </div>
                    {masked && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success shadow-[0_0_8px_rgba(115,216,108,0.7)]" />
                    )}
                  </div>

                  {provider.docs && (
                    <p className="mt-2.5 flex items-center gap-1 truncate text-[10px] text-foreground-muted">
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      {provider.docs}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-1.5">
                    {isTyping ? (
                      <span className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.08] px-2 py-1 text-[10px] font-medium text-primary">
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                        Validating with provider
                      </span>
                    ) : masked ? (
                      <>
                        <span className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground-secondary">
                          <RefreshCw className="h-2.5 w-2.5" />
                          Refresh models
                        </span>
                        <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground-secondary">
                          Replace Key
                        </span>
                      </>
                    ) : (
                      <span className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground-secondary">
                        <Plus className="h-2.5 w-2.5" />
                        Add Key
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
