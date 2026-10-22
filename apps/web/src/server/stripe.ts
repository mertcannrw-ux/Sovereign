import Stripe from 'stripe';
import type { Prisma, PrismaClient } from '@prisma-generated/prisma/client';
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

/** Paid plans are launched and purchasable; otherwise they are "coming soon". */
export function arePaidPlansAvailable(): boolean {
  return env.PAID_PLANS_ENABLED && isBillingConfigured();
}

/**
 * Fail before a destructive operation starts when it would have to cancel a
 * subscription but Stripe is not configured. Once the Realm/account rows are
 * gone there is no handle left to retry the cancellation with, so callers run
 * this check inside the delete transaction, before deleting anything.
 */
export function assertStripeCancellationAvailable(
  subscriptionIds: ReadonlyArray<string | null | undefined>,
): void {
  if (!subscriptionIds.some(Boolean)) return;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set; refusing to delete data for subscriptions Stripe may still bill.',
    );
  }
}

/**
 * Cancel the given Stripe subscriptions for good.
 *
 * Called *after* the Realm (or account) rows commit their deletion: a database
 * failure must leave the subscription intact, and a Stripe cancellation cannot
 * be undone. `assertStripeCancellationAvailable` runs before the deletion, so
 * the configuration failure below cannot happen once data is already gone; a
 * Stripe failure at this point is logged by the caller for manual follow-up.
 */
export async function cancelStripeSubscriptions(
  subscriptionIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const ids = subscriptionIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  // Fail closed: without the key we cannot prove these are gone - a live one
  // would keep charging a customer we can no longer look up.
  assertStripeCancellationAvailable(ids);

  const stripe = getStripe();
  for (const id of ids) {
    try {
      await stripe.subscriptions.cancel(id);
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        (error.code === 'resource_missing' || /no such subscription/i.test(error.message))
      ) {
        continue;
      }
      throw error;
    }
  }
}

const STATUS_MAP: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELED',
  canceled: 'CANCELED',
  // A paused subscription is still live at Stripe (it can resume and it blocks
  // a second checkout), so it must not map to CANCELED: that made the UI offer
  // Subscribe and every attempt fail with CONFLICT. PAST_DUE keeps entitlement
  // off and the portal path available.
  paused: 'PAST_DUE',
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
 * paid: called after creating a session and after one completes (stale tabs can
 * no longer subscribe a second time).
 *
 * `keepSessionId` is the session just created. It must be excluded: a retry
 * inside the same idempotency bucket replays that session, so expiring it
 * would hand the caller a dead URL.
 */
export async function expireOpenCheckoutSessions(
  stripe: Stripe,
  customerId: string,
  keepSessionId?: string,
): Promise<void> {
  for await (const session of stripe.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 100,
  })) {
    if (session.id === keepSessionId) continue;
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      // It completed or expired since it was listed; the webhook's duplicate
      // check reports the former.
      console.warn(`[stripe] Could not expire checkout session ${session.id}`, error);
    }
  }
}

type SyncDb = Prisma.TransactionClient;

/** Bounded so a pathological webhook storm cannot spin forever. */
const SYNC_MAX_ATTEMPTS = 5;

/**
 * Mirror one Stripe subscription onto its Realm's `Subscription` row.
 *
 * Always re-reads the subscription from Stripe instead of trusting the event
 * body, so retried, duplicated or out-of-order webhooks all converge on
 * Stripe's current state. The Realm is resolved through our own
 * customer → Realm mapping (created at checkout), never from event data.
 *
 * Stripe calls stay *outside* the database transaction: an interactive
 * transaction holds a connection for its whole lifetime, and a slow Stripe API
 * or a burst of webhooks would then exhaust the pool and fail every sync with
 * Prisma's 5 s transaction timeout. Instead the row's `updatedAt` acts as an
 * optimistic fence: if another sync committed since the snapshot was read, the
 * write is refused and the whole read is retried, so an older snapshot can
 * never land last and leave a paying Realm on the free plan.
 */
export async function syncSubscription(
  db: PrismaClient,
  stripe: Stripe,
  subscriptionId: string,
): Promise<void> {
  // The first read only resolves the customer, which is the lock key and the
  // row key used by every retry below.
  const initial = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = typeof initial.customer === 'string' ? initial.customer : initial.customer.id;

  for (let attempt = 1; ; attempt += 1) {
    // Read the fence *before* fetching the snapshot: any sync that commits
    // after this point bumps `updatedAt`, which makes the transaction below
    // retry instead of overwriting a newer snapshot with this older one.
    const rowBefore = await db.subscription.findUnique({
      where: { stripeCustomerId: customerId },
      select: { updatedAt: true },
    });
    if (!rowBefore) {
      console.warn(`[stripe] Ignoring subscription ${subscriptionId} for unknown customer`);
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    const outcome = await db.$transaction(async (tx: SyncDb) => {
      // Serialise concurrent syncs for one customer. The lock is held only for
      // local reads/writes now, never across a Stripe request.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-sync:${customerId}`}, 0))`;

      const row = await tx.subscription.findUnique({
        where: { stripeCustomerId: customerId },
        select: { id: true, stripeSubscriptionId: true, updatedAt: true },
      });
      if (!row) return { status: 'missing' as const };

      if (row.updatedAt.getTime() !== rowBefore.updatedAt.getTime()) {
        return { status: 'stale' as const };
      }

      // A late event for a Realm's previous, already-ended subscription must
      // not overwrite the subscription it has now.
      if (
        row.stripeSubscriptionId &&
        row.stripeSubscriptionId !== subscription.id &&
        ENDED_STATUSES.has(subscription.status)
      ) {
        return { status: 'skipped' as const };
      }

      const item = subscription.items.data[0];
      await tx.subscription.update({
        where: { id: row.id },
        data: {
          stripeSubscriptionId: subscription.id,
          priceId: item?.price.id ?? null,
          status: mapSubscriptionStatus(subscription.status),
          currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      });
      return {
        status: 'written' as const,
        previousSubscriptionId: row.stripeSubscriptionId,
      };
    });

    if (outcome.status === 'missing') {
      console.warn(`[stripe] Ignoring subscription ${subscription.id} for unknown customer`);
      return;
    }
    if (outcome.status === 'skipped') return;
    if (outcome.status === 'stale') {
      if (attempt >= SYNC_MAX_ATTEMPTS) {
        // Let Stripe retry the webhook rather than silently leaving the row on
        // whichever snapshot happened to lose the race.
        throw new Error(
          `Could not sync subscription ${subscriptionId}: concurrent updates kept winning`,
        );
      }
      continue;
    }

    // Checkout guards against a second subscription, but if two still slip
    // through, both bill. Flag it for a refund rather than cancel automatically.
    // This diagnostic read happens after the write commits so a slow Stripe
    // call cannot roll back (or time out) the state update.
    if (
      outcome.previousSubscriptionId &&
      outcome.previousSubscriptionId !== subscription.id &&
      LIVE_STATUSES.has(subscription.status)
    ) {
      try {
        const recorded = await stripe.subscriptions.retrieve(outcome.previousSubscriptionId);
        if (LIVE_STATUSES.has(recorded.status)) {
          console.error(
            `[stripe] DUPLICATE SUBSCRIPTION: customer ${customerId} has live subscriptions ` +
              `${recorded.id} and ${subscription.id}; cancel and refund one in the Stripe Dashboard`,
          );
        }
      } catch (error) {
        console.error(
          `[stripe] Could not inspect previous subscription ${outcome.previousSubscriptionId}`,
          error,
        );
      }
    }
    return;
  }
}
