import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma-generated/prisma/client';
import type { SubscriptionStatus } from '@app-builder/shared';

/**
 * Plan resolution and limits.
 *
 * The plan is always derived from the Realm's `Subscription` row, which only the
 * Stripe webhook writes. Anything that is not a known price in an access-granting
 * status resolves to Free, so a missing, stale or half-written row can never
 * unlock a paid plan.
 */

export type Plan = 'free' | 'pro' | 'business';
export type PaidPlan = Exclude<Plan, 'free'>;

export interface PlanLimits {
  /** Non-archived projects per Realm; null means unlimited. */
  activeProjects: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { activeProjects: 3 },
  pro: { activeProjects: null },
  business: { activeProjects: null },
};

/** Stripe price IDs per paid plan, as configured in the environment. */
export type PlanPrices = Partial<Record<PaidPlan, string>>;

const ACCESS_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['ACTIVE', 'TRIALING']);

/** How long a stored period may overrun before the row stops granting access. */
const PERIOD_EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * A missing period is not evidence of expiry: only a recorded end that is well
 * past can lapse, so an unset column never revokes a paying Realm.
 */
function isPeriodLapsed(currentPeriodEnd: Date | null | undefined): boolean {
  const periodEnd = currentPeriodEnd?.getTime();
  return Boolean(periodEnd && periodEnd + PERIOD_EXPIRY_GRACE_MS < Date.now());
}

export function planForPriceId(
  priceId: string | null | undefined,
  prices: PlanPrices,
): PaidPlan | null {
  if (!priceId) return null;
  if (prices.pro && priceId === prices.pro) return 'pro';
  if (prices.business && priceId === prices.business) return 'business';
  return null;
}

/**
 * Entitlement from a stored subscription row.
 *
 * A terminal webhook can be lost (endpoint disabled after Stripe's retry
 * window), so entitlement also expires on its own: an ACTIVE/TRIALING row whose
 * period ended more than a day ago grants nothing, even if the row still says
 * otherwise.
 */
export function planFromSubscription(
  subscription: {
    status: SubscriptionStatus;
    priceId: string | null;
    currentPeriodEnd?: Date | null;
  } | null,
  prices: PlanPrices,
): Plan {
  if (!subscription || !ACCESS_STATUSES.has(subscription.status)) return 'free';
  if (isPeriodLapsed(subscription.currentPeriodEnd)) return 'free';
  return planForPriceId(subscription.priceId, prices) ?? 'free';
}

/**
 * A Realm's subscription grants access, so a new checkout would double-bill it.
 *
 * Mirrors `planFromSubscription`'s period rule: an ACTIVE/TRIALING row whose
 * period lapsed grants nothing, so it must not block checkout either - that
 * pairing is what let a lost terminal webhook both downgrade the Realm and
 * trap it behind a subscription guard it could never clear. PAST_DUE is exempt:
 * Stripe keeps retrying the charge, so a second checkout would still double-bill.
 */
export function hasLiveSubscription(
  subscription: {
    status: SubscriptionStatus;
    stripeSubscriptionId: string | null;
    currentPeriodEnd?: Date | null;
  } | null,
): boolean {
  if (!subscription?.stripeSubscriptionId) return false;
  if (subscription.status === 'PAST_DUE') return true;
  if (!ACCESS_STATUSES.has(subscription.status)) return false;
  return !isPeriodLapsed(subscription.currentPeriodEnd);
}

type PlanDb = Pick<Prisma.TransactionClient, 'subscription' | 'project'>;

/**
 * Note that a user tried to subscribe to a paid plan before paid plans
 * launched. Counted once per user and plan, however often they click:
 * ON CONFLICT DO NOTHING, so double-clicks cannot race into two rows.
 */
export async function recordPlanInterest(
  db: Pick<Prisma.TransactionClient, 'planInterest'>,
  userId: string,
  plan: PaidPlan,
): Promise<void> {
  await db.planInterest.createMany({ data: [{ userId, plan }], skipDuplicates: true });
}

export async function getRealmPlan(db: PlanDb, realmId: string, prices: PlanPrices): Promise<Plan> {
  const subscription = await db.subscription.findUnique({
    where: { realmId },
    select: { status: true, priceId: true, currentPeriodEnd: true },
  });
  return planFromSubscription(subscription, prices);
}

/**
 * Throws when the Realm is at its plan's active-project limit. Call inside the
 * project-create transaction, after `lockRealm`, so concurrent
 * creates are serialized and cannot both slip under the limit.
 */
export async function assertCanCreateProject(
  db: PlanDb,
  realmId: string,
  prices: PlanPrices,
): Promise<void> {
  const plan = await getRealmPlan(db, realmId, prices);
  const limit = PLAN_LIMITS[plan].activeProjects;
  if (limit === null) return;

  const active = await db.project.count({
    where: { realmId, status: { not: 'ARCHIVED' } },
  });
  if (active >= limit) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `The Free plan includes ${limit} active projects. Archive one to start another.`,
    });
  }
}
