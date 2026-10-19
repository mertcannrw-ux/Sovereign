'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc/client';
import { useCurrentRealm } from '@/lib/use-current-realm';

type PaidPlan = 'pro' | 'business';

const PLAN_DETAILS = {
  free: { name: 'Free', price: '$0', summary: '3 active projects' },
  pro: { name: 'Pro', price: '$25', summary: 'Unlimited projects' },
  business: {
    name: 'Business',
    price: '$50',
    summary: 'Unlimited projects, built for shared Realms',
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
  const [comingSoonPlan, setComingSoonPlan] = useState<PaidPlan | null>(null);

  const billing = planQuery.data;
  const awaitingCheckout = returnedFromCheckout && !billing?.hasSubscription;

  /** Before launch, a subscribe click records interest and explains instead. */
  function showComingSoon(plan: PaidPlan) {
    setComingSoonPlan(plan);
    interestMutation.mutate({ plan });
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Billing</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Your plan covers this Realm. AI usage is billed by its own providers.
        </p>
      </div>

      {awaitingCheckout && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background-subtle px-4 py-3 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Confirming your subscription with Stripe…
        </div>
      )}

      <Card className="border-border bg-background-subtle">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold text-foreground">{current.name}</p>
              {status && billing.hasSubscription && (
                <Badge variant={status.variant}>{status.label}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-foreground-muted">{current.summary}</p>
            {billing.hasSubscription && billing.currentPeriodEnd && (
              <p className="mt-2 text-sm text-foreground-muted">
                {billing.cancelAtPeriodEnd
                  ? `Ends on ${formatDate(billing.currentPeriodEnd)}`
                  : billing.status === 'TRIALING'
                    ? `Trial ends on ${formatDate(billing.currentPeriodEnd)}`
                    : `Renews on ${formatDate(billing.currentPeriodEnd)}`}
              </p>
            )}
            {billing.status === 'PAST_DUE' && (
              <p className="mt-2 text-sm text-error">
                Your last payment failed. Update your payment method to restore your plan.
              </p>
            )}
          </div>
          {billing.canManage && billing.hasBillingAccount && billing.billingConfigured && (
            <Button variant="outline" onClick={openPortal} disabled={busy}>
              {portalMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              Manage billing
            </Button>
          )}
        </CardContent>
      </Card>

      {!billing.hasSubscription && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(['pro', 'business'] as const).map((plan) => (
            <Card key={plan} className="border-border bg-background-subtle">
              <CardContent className="flex h-full flex-col p-6">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">{PLAN_DETAILS[plan].name}</p>
                  {comingSoon && <Badge variant="secondary">Coming soon</Badge>}
                </div>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {PLAN_DETAILS[plan].price}
                  <span className="text-sm font-normal text-foreground-muted"> / month</span>
                </p>
                <p className="mt-2 flex items-center gap-2 text-sm text-foreground-muted">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {PLAN_DETAILS[plan].summary}
                </p>
                <Button
                  className="mt-6"
                  onClick={() => (comingSoon ? showComingSoon(plan) : startCheckout(plan))}
                  disabled={!comingSoon && (!canUpgrade || busy)}
                >
                  {checkoutMutation.isPending && checkoutMutation.variables?.plan === plan && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Upgrade to {PLAN_DETAILS[plan].name}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!comingSoon && !billing.canManage && (
        <p className="text-sm text-foreground-muted">
          Only the owner of this Realm can change the plan.
        </p>
      )}
      {!comingSoon && !billing.billingConfigured && (
        <p className="text-sm text-foreground-muted">Billing is not configured on this server.</p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}

      <Dialog
        open={comingSoonPlan !== null}
        onOpenChange={(open) => !open && setComingSoonPlan(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {comingSoonPlan ? PLAN_DETAILS[comingSoonPlan].name : ''} is coming soon
            </DialogTitle>
            <DialogDescription>
              Paid plans are not available yet, and we have noted your interest. Until they launch,
              everything runs on the Free plan with {PLAN_DETAILS.free.summary}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Got it</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
