'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CircleUser, CodeXml, CreditCard, Loader2, Users } from 'lucide-react';
import { AIKey } from '@/components/ui/ai-key-icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@app-builder/ui/utils';
import { AIProvidersPanel } from '@/components/settings/ai-providers-panel';
import { BillingPanel } from '@/components/settings/billing-panel';

/* ── Tab Navigation ───────────────────────────────────────── */

const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile', icon: CircleUser },
  { id: 'providers', label: 'AI Providers', icon: AIKey },
  { id: 'teams', label: 'Team', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'developer-api', label: 'Developer API', icon: CodeXml },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/* ── Page ────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('providers');

  // Stripe Checkout and the Customer Portal return to `?tab=billing`.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (SETTINGS_TABS.some((t) => t.id === tab)) setActiveTab(tab as SettingsTabId);
  }, []);

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
      <div className="mx-auto w-full min-w-0 max-w-[1200px] px-5 py-8 sm:px-8 lg:py-10">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Settings</h1>
        <div className="mt-6 flex flex-col gap-8 md:flex-row md:gap-12">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto pb-2 md:w-56 md:flex-col md:overflow-visible"
            aria-label="Settings sections"
          >
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
            {activeTab === 'profile' && (
              <Placeholder
                title="Profile"
                desc="Manage your account identity and personal preferences."
              />
            )}
            {activeTab === 'providers' && <AIProvidersPanel />}
            {activeTab === 'teams' && (
              <Card className="border-border bg-background-subtle">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <h2 className="text-xl font-semibold text-foreground">Teams</h2>
                  <p className="mt-2 text-sm text-foreground-muted">
                    Invite collaborators and manage workspace permissions.
                  </p>
                  <Button className="mt-6" asChild>
                    <a href="/dashboard/team">Open team page</a>
                  </Button>
                </CardContent>
              </Card>
            )}
            {activeTab === 'billing' && <BillingPanel />}
            {activeTab === 'developer-api' && (
              <Placeholder
                title="Developer API"
                desc="Tokens for calling Sovereign's own API. Not available yet."
              />
            )}
          </div>
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
