'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { Mascot, type LogoState } from '@/components/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { useCurrentRealm } from '@/lib/use-current-realm';

type PaidPlan = 'pro' | 'business';

const PLAN_DETAILS = {
  free: { name: 'Free', price: '$0' },
  pro: { name: 'Pro', price: '$25', summary: 'Unlimited active projects' },
  business: {
    name: 'Business',
    price: '$50',
    summary: 'Unlimited active projects · Shared Realm for teams',
  },
} as const;

const STATUS_LABELS = {
  TRIALING: { label: 'Trial', variant: 'default' },
  ACTIVE: { label: 'Active', variant: 'success' },
  PAST_DUE: { label: 'Payment failed', variant: 'error' },
  CANCELED: { label: 'Canceled', variant: 'secondary' },
  INCOMPLETE: { label: 'Incomplete', variant: 'warning' },
} as const;

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function BillingPanel() {
  const { realm, isLoading: realmsLoading } = useCurrentRealm();
  const realmId = realm?.id ?? '';
  const [returnedFromCheckout, setReturnedFromCheckout] = useState(false);
  const [error, setError] = useState('');

  // Returning from Checkout: the webhook, not the redirect, grants the plan, so
  // poll briefly until it lands.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') !== 'success') return;
    setReturnedFromCheckout(true);
    const timeout = setTimeout(() => setReturnedFromCheckout(false), 30_000);
    return () => clearTimeout(timeout);
  }, []);

  const planQuery = trpc.billing.getPlan.useQuery(
    { realmId },
    {
      enabled: Boolean(realmId),
      refetchInterval: (query) =>
        returnedFromCheckout && !query.state.data?.hasSubscription ? 2000 : false,
    },
  );
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation();
  const portalMutation = trpc.billing.createPortalSession.useMutation();
  const interestMutation = trpc.billing.registerInterest.useMutation();
  const [notifiedPlans, setNotifiedPlans] = useState<PaidPlan[]>([]);

  const billing = planQuery.data;
  const awaitingCheckout = returnedFromCheckout && !billing?.hasSubscription;

  /** Before launch, a click records interest and the row confirms it in place. */
  function notifyMe(plan: PaidPlan) {
    setError('');
    setNotifiedPlans((plans) => (plans.includes(plan) ? plans : [...plans, plan]));
    interestMutation.mutate(
      { plan },
      {
        onError: (err) => {
          setNotifiedPlans((plans) => plans.filter((item) => item !== plan));
          setError(err.message || 'Could not save your interest.');
        },
      },
    );
  }

  async function startCheckout(plan: PaidPlan) {
    setError('');
    try {
      const { url } = await checkoutMutation.mutateAsync({ realmId, plan });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
    }
  }

  async function openPortal() {
    setError('');
    try {
      const { url } = await portalMutation.mutateAsync({ realmId });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the billing portal.');
    }
  }

  if (realmsLoading || (realmId && planQuery.isLoading)) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (!realmId || !billing) {
    return (
      <Card className="border-border bg-background-subtle">
        <CardContent className="py-16 text-center text-sm text-foreground-muted">
          Could not load billing. Try again in a moment.
        </CardContent>
      </Card>
    );
  }

  const current = PLAN_DETAILS[billing.plan];
  const status = billing.status ? STATUS_LABELS[billing.status] : null;
  const busy = checkoutMutation.isPending || portalMutation.isPending;
  const comingSoon = !billing.paidPlansAvailable;
  const canUpgrade = billing.canManage && billing.billingConfigured && !billing.hasSubscription;
  const problem = billing.status === 'PAST_DUE';
  const limit = billing.limits.activeProjects;
  const used = billing.activeProjects;
  const atLimit = limit !== null && used >= limit;
  const usagePercent = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const notified = new Set<PaidPlan>([...billing.interestedPlans, ...notifiedPlans]);
  const statusMessage = awaitingCheckout
    ? 'Confirming your subscription with Stripe…'
    : problem
      ? 'Your last payment failed. Update your payment method to restore your plan.'
      : null;
  const mascotState: LogoState = awaitingCheckout || busy ? 'working' : problem ? 'error' : 'idle';

  const periodLabel = billing.cancelAtPeriodEnd
    ? 'Ends'
    : billing.status === 'TRIALING'
      ? 'Trial ends'
      : 'Renews';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">Billing</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          One plan covers this Realm. AI usage is billed directly by your own providers.
        </p>
      </div>

      <Card className="border-border bg-background-subtle">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <Mascot size={48} state={mascotState} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.08em] text-foreground-muted">
                    Current plan
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">
                      {current.name}
                    </h3>
                    {status && billing.hasSubscription && (
                      <Badge variant={status.variant}>{status.label}</Badge>
                    )}
                  </div>
                </div>
                <p className="ml-auto shrink-0 text-right tabular-nums">
                  <span className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                    {current.price}
                  </span>
                  <span className="text-sm text-foreground-muted"> / month</span>
                </p>
              </div>

              {statusMessage && (
                <p
                  role="status"
                  className={cn('mt-2 text-sm', problem ? 'text-error' : 'text-foreground-muted')}
                >
                  {statusMessage}
                </p>
              )}

              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-foreground-muted">Active projects</span>
                  <span className="tabular-nums text-foreground">
                    {limit === null ? `${used} · No limit` : `${used} of ${limit}`}
                  </span>
                </div>

                {limit !== null && (
                  <div
                    role="progressbar"
                    aria-label="Active projects"
                    aria-valuemin={0}
                    aria-valuemax={limit}
                    aria-valuenow={Math.min(used, limit)}
                    aria-valuetext={`${used} of ${limit} active projects`}
                    className="mt-2 h-1 overflow-hidden rounded-full bg-background-muted"
                  >
                    <div
                      className={cn('h-full rounded-full', atLimit ? 'bg-warning' : 'bg-primary')}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                )}

                {atLimit && (
                  <p className="mt-2 text-sm text-warning">
                    Limit reached.{' '}
                    <Link
                      href="/dashboard"
                      className="rounded-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
                    >
                      Archive a project
                    </Link>{' '}
                    or upgrade to start a new one.
                  </p>
                )}
              </div>

              {billing.hasSubscription && billing.currentPeriodEnd && !problem && (
                <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-3 text-sm">
                  <span className="text-foreground-muted">{periodLabel}</span>
                  <span className="text-foreground">{formatDate(billing.currentPeriodEnd)}</span>
                </div>
              )}
            </div>
          </div>

          {billing.canManage && billing.hasBillingAccount && billing.billingConfigured && (
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={openPortal} disabled={busy}>
                {portalMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Manage billing
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      {!billing.hasSubscription && (
        <section aria-labelledby="upgrade-plans">
          <h3 id="upgrade-plans" className="text-sm font-semibold text-foreground">
            Upgrade
          </h3>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-card border border-border">
            {(['pro', 'business'] as const).map((plan) => {
              const isNotified = notified.has(plan);
              const primary = !comingSoon && plan === 'pro' && atLimit;
              const disabled = comingSoon ? isNotified : !canUpgrade || busy;
              const actionLabel = comingSoon
                ? isNotified
                  ? "You'll be notified ✓"
                  : 'Notify me'
                : `Upgrade to ${PLAN_DETAILS[plan].name}`;

              return (
                <li
                  key={plan}
                  className={cn(
                    'grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-start sm:gap-6 sm:px-6',
                    plan === 'pro' && atLimit && 'border-l border-primary',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-base font-semibold text-foreground">
                        {PLAN_DETAILS[plan].name}
                      </p>
                      {comingSoon && <Badge variant="outline">Coming soon</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-foreground-muted">
                      {PLAN_DETAILS[plan].summary}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:items-end">
                    <p className="text-sm text-foreground-muted">
                      <span className="text-base font-semibold tabular-nums text-foreground">
                        {PLAN_DETAILS[plan].price}
                      </span>{' '}
                      / month
                    </p>

                    <Button
                      variant={primary ? 'default' : 'outline'}
                      className="w-full"
                      onClick={() => (comingSoon ? notifyMe(plan) : startCheckout(plan))}
                      disabled={disabled}
                    >
                      {checkoutMutation.isPending && checkoutMutation.variables?.plan === plan && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {actionLabel}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          {!comingSoon && !billing.canManage && (
            <p className="mt-3 text-sm text-foreground-muted">
              Only the owner of this Realm can change the plan.
            </p>
          )}
          {!comingSoon && !billing.billingConfigured && (
            <p className="mt-3 text-sm text-foreground-muted">
              Billing is not configured on this server.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
