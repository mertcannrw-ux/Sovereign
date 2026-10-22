'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CircleUser, CodeXml, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@app-builder/ui/utils';
import { ProfilePanel } from '@/components/settings/profile-panel';

/* ── Tab Navigation ───────────────────────────────────────── */

/**
 * Settings are about you. Everything about a Realm (its members, keys and
 * billing) lives in the Realm settings menu, opened from the Realm switcher.
 */
const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile', icon: CircleUser },
  { id: 'developer-api', label: 'Developer API', icon: CodeXml },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/* ── Page ────────────────────────────────────────────────── */

export default function SettingsPage() {
  // `useSearchParams` suspends during prerendering. Without a Suspense
  // boundary Next fails the build with a CSR-bailout error instead of serving
  // the shell and hydrating the tab selection.
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-foreground-muted" />
    </div>
  );
}

function SettingsPageContent() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile');

  // Connecting a sign-in provider returns to `?tab=profile`.
  // Reads the search params reactively: a same-route navigation does not
  // remount the component, so a mount-only effect would not run again.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  useEffect(() => {
    if (SETTINGS_TABS.some((t) => t.id === tabParam)) setActiveTab(tabParam as SettingsTabId);
  }, [tabParam]);

  if (status === 'loading') return <SettingsLoading />;
  if (!session) {
    // Redirect from an effect, never during render.
    return <SignInRedirect />;
  }

  const tabButton = (tab: (typeof SETTINGS_TABS)[number]) => (
    <button
      key={tab.id}
      role="tab"
      aria-selected={activeTab === tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={cn(
        'flex h-11 shrink-0 items-center gap-3 rounded-lg px-3.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
        activeTab === tab.id
          ? 'bg-background-muted text-foreground'
          : 'text-foreground-muted hover:bg-background-subtle hover:text-foreground',
      )}
    >
      <tab.icon className={cn('h-4 w-4', activeTab === tab.id && 'text-primary')} />
      {tab.label}
    </button>
  );

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full min-w-0 max-w-[1200px] px-5 py-8 sm:px-8 lg:py-10">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Settings</h1>
        <div className="mt-6 flex flex-col gap-8 md:flex-row md:gap-12">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto pb-2 md:w-56 md:flex-col md:overflow-visible"
            aria-label="Settings sections"
          >
            {SETTINGS_TABS.map(tabButton)}
          </nav>
          <div className="min-w-0 flex-1">
            {activeTab === 'profile' && <ProfilePanel />}
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

function SignInRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/auth/signin');
  }, [router]);
  return <SettingsLoading />;
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
