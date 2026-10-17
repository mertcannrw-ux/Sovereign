import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma-generated/prisma/client';
import type { SubscriptionStatus } from '@app-builder/shared';

/**
 * Plan resolution and limits.
 *
 * The plan is always derived from the org's `Subscription` row, which only the
 * Stripe webhook writes. Anything that is not a known price in an access-granting
 * status resolves to Free, so a missing, stale or half-written row can never
 * unlock a paid plan.
 */

export type Plan = 'free' | 'pro' | 'business';
export type PaidPlan = Exclude<Plan, 'free'>;

export interface PlanLimits {
  /** Non-archived projects per organization; null means unlimited. */
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

export function planForPriceId(
  priceId: string | null | undefined,
  prices: PlanPrices,
): PaidPlan | null {
  if (!priceId) return null;
  if (prices.pro && priceId === prices.pro) return 'pro';
  if (prices.business && priceId === prices.business) return 'business';
  return null;
}

export function planFromSubscription(
  subscription: { status: SubscriptionStatus; priceId: string | null } | null,
  prices: PlanPrices,
): Plan {
  if (!subscription || !ACCESS_STATUSES.has(subscription.status)) return 'free';
  return planForPriceId(subscription.priceId, prices) ?? 'free';
}

/** An org's subscription grants access, so a new checkout would double-bill it. */
export function hasLiveSubscription(
  subscription: { status: SubscriptionStatus; stripeSubscriptionId: string | null } | null,
): boolean {
  return Boolean(
    subscription?.stripeSubscriptionId &&
    (ACCESS_STATUSES.has(subscription.status) || subscription.status === 'PAST_DUE'),
  );
}

type PlanDb = Pick<Prisma.TransactionClient, 'subscription' | 'project'>;

export async function getOrgPlan(
  db: PlanDb,
  organizationId: string,
  prices: PlanPrices,
): Promise<Plan> {
  const subscription = await db.subscription.findUnique({
    where: { organizationId },
    select: { status: true, priceId: true },
  });
  return planFromSubscription(subscription, prices);
}

/**
 * Throws when the org is at its plan's active-project limit. Call inside the
 * project-create transaction, after `lockOrganizationMembership`, so concurrent
 * creates are serialized and cannot both slip under the limit.
 */
export async function assertCanCreateProject(
  db: PlanDb,
  organizationId: string,
  prices: PlanPrices,
): Promise<void> {
  const plan = await getOrgPlan(db, organizationId, prices);
  const limit = PLAN_LIMITS[plan].activeProjects;
  if (limit === null) return;

  const active = await db.project.count({
    where: { organizationId, status: { not: 'ARCHIVED' } },
  });
  if (active >= limit) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `The Free plan includes ${limit} active projects. Upgrade to Pro for unlimited projects.`,
    });
  }
}
