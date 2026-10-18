import Stripe from 'stripe';
import type { Prisma } from '@prisma-generated/prisma/client';
import type { SubscriptionStatus } from '@app-builder/shared';
import { env } from '@/env';
import type { PlanPrices } from '@/server/plans';

/**
 * Stripe billing service.
 *
 * Card data never touches this app: checkout and payment-method changes happen
 * on Stripe-hosted Checkout and Customer Portal pages. The only writer of the
 * `Subscription` row's billing state is `syncSubscription`, called from the
 * signature-verified webhook.
 */

let client: Stripe | null = null;

/** Lazily constructed so the app boots without billing configured. */
export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  // The SDK pins its own API version, so an exact `stripe` package version
  // keeps request and webhook payload shapes stable.
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

export function getPlanPrices(): PlanPrices {
  return { pro: env.STRIPE_PRICE_ID_PRO, business: env.STRIPE_PRICE_ID_BUSINESS };
}

export function isBillingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID_PRO && env.STRIPE_PRICE_ID_BUSINESS);
}

const STATUS_MAP: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELED',
  canceled: 'CANCELED',
  paused: 'CANCELED',
};

export function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  return STATUS_MAP[status] ?? 'INCOMPLETE';
}

const ENDED_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'canceled',
  'incomplete_expired',
]);

/**
 * Subscriptions a customer still has (or owes on), per Stripe's guide to
 * limiting customers to one subscription. A new checkout would bill twice.
 */
const LIVE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
]);

export interface CustomerSubscriptionState {
  /** The customer has a subscription that a new checkout would duplicate. */
  hasLive: boolean;
  /** The customer has ever had a subscription, so its free trial is used up. */
  hasAny: boolean;
}

/**
 * Ask Stripe, not our database, which lags behind until the webhook lands,
 * whether the customer is already subscribed.
 */
export async function getCustomerSubscriptionState(
  stripe: Stripe,
  customerId: string,
): Promise<CustomerSubscriptionState> {
  const state: CustomerSubscriptionState = { hasLive: false, hasAny: false };
  for await (const subscription of stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  })) {
    state.hasAny = true;
    if (LIVE_STATUSES.has(subscription.status)) {
      state.hasLive = true;
      break;
    }
  }
  return state;
}

/**
 * Expire the customer's open Checkout Sessions so at most one can ever be
 * paid: called before creating a new one (the newest tab wins) and after one
 * completes (stale tabs can no longer subscribe a second time).
 */
export async function expireOpenCheckoutSessions(
  stripe: Stripe,
  customerId: string,
): Promise<void> {
  for await (const session of stripe.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 100,
  })) {
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      // It completed or expired since it was listed; the webhook's duplicate
      // check reports the former.
      console.warn(`[stripe] Could not expire checkout session ${session.id}`, error);
    }
  }
}

type SyncDb = Pick<Prisma.TransactionClient, 'subscription'>;

/**
 * Mirror one Stripe subscription onto its org's `Subscription` row.
 *
 * Always re-reads the subscription from Stripe instead of trusting the event
 * body, so retried, duplicated or out-of-order webhooks all converge on
 * Stripe's current state. The org is resolved through our own
 * customer → organization mapping (created at checkout), never from event data.
 */
export async function syncSubscription(
  db: SyncDb,
  stripe: Stripe,
  subscriptionId: string,
): Promise<void> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const row = await db.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true, stripeSubscriptionId: true },
  });
  if (!row) {
    console.warn(`[stripe] Ignoring subscription ${subscription.id} for unknown customer`);
    return;
  }

  // A late event for an org's previous, already-ended subscription must not
  // overwrite the subscription it has now.
  if (
    row.stripeSubscriptionId &&
    row.stripeSubscriptionId !== subscription.id &&
    ENDED_STATUSES.has(subscription.status)
  ) {
    return;
  }

  // Checkout guards against a second subscription, but if two still slip
  // through, both bill. Flag it for a refund rather than cancel automatically.
  if (
    row.stripeSubscriptionId &&
    row.stripeSubscriptionId !== subscription.id &&
    LIVE_STATUSES.has(subscription.status)
  ) {
    const recorded = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
    if (LIVE_STATUSES.has(recorded.status)) {
      console.error(
        `[stripe] DUPLICATE SUBSCRIPTION: customer ${customerId} has live subscriptions ` +
          `${recorded.id} and ${subscription.id}; cancel and refund one in the Stripe Dashboard`,
      );
    }
  }

  const item = subscription.items.data[0];
  await db.subscription.update({
    where: { id: row.id },
    data: {
      stripeSubscriptionId: subscription.id,
      priceId: item?.price.id ?? null,
      status: mapSubscriptionStatus(subscription.status),
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}
