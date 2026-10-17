'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';

const PLAN_DETAILS = {
  free: { name: 'Free', price: '$0', summary: '3 active projects' },
  pro: { name: 'Pro', price: '$25', summary: 'Unlimited projects' },
  business: { name: 'Business', price: '$50', summary: 'Unlimited projects, built for teams' },
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
  const orgsQuery = trpc.organizations.list.useQuery();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const orgId = selectedOrgId || orgsQuery.data?.[0]?.id || '';
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
    { organizationId: orgId },
    {
      enabled: Boolean(orgId),
      refetchInterval: (query) =>
        returnedFromCheckout && !query.state.data?.hasSubscription ? 2000 : false,
    },
  );
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation();
  const portalMutation = trpc.billing.createPortalSession.useMutation();

  const billing = planQuery.data;
  const awaitingCheckout = returnedFromCheckout && !billing?.hasSubscription;

  async function startCheckout(plan: 'pro' | 'business') {
    setError('');
    try {
      const { url } = await checkoutMutation.mutateAsync({ organizationId: orgId, plan });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
    }
  }

  async function openPortal() {
    setError('');
    try {
      const { url } = await portalMutation.mutateAsync({ organizationId: orgId });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the billing portal.');
    }
  }

  if (orgsQuery.isLoading || (orgId && planQuery.isLoading)) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (!orgId || !billing) {
    return (
      <Card className="border-border bg-background-subtle">
        <CardContent className="py-16 text-center text-sm text-foreground-muted">
          {orgsQuery.isError || planQuery.isError
            ? 'Could not load billing. Try again in a moment.'
            : 'No workspace found. Create or join an organization first.'}
        </CardContent>
      </Card>
    );
  }

  const current = PLAN_DETAILS[billing.plan];
  const status = billing.status ? STATUS_LABELS[billing.status] : null;
  const busy = checkoutMutation.isPending || portalMutation.isPending;
  const canUpgrade = billing.canManage && billing.billingConfigured && !billing.hasSubscription;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Billing</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Your plan covers the workspace. AI usage is billed by your own providers.
        </p>
      </div>

      {(orgsQuery.data?.length ?? 0) > 1 && (
        <select
          value={orgId}
          onChange={(event) => setSelectedOrgId(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background-subtle px-3 text-sm text-foreground"
          aria-label="Workspace"
        >
          {orgsQuery.data?.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      )}

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
                <p className="font-semibold text-foreground">{PLAN_DETAILS[plan].name}</p>
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
                  onClick={() => startCheckout(plan)}
                  disabled={!canUpgrade || busy}
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

      {!billing.canManage && (
        <p className="text-sm text-foreground-muted">
          Only workspace owners and admins can change the plan.
        </p>
      )}
      {!billing.billingConfigured && (
        <p className="text-sm text-foreground-muted">Billing is not configured on this server.</p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
