import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import { env } from '@/env';
import { requireRealmRole } from '@/server/authz';
import {
  PLAN_LIMITS,
  hasLiveSubscription,
  planFromSubscription,
  recordPlanInterest,
} from '@/server/plans';
import {
  arePaidPlansAvailable,
  expireOpenCheckoutSessions,
  getCustomerSubscriptionState,
  getPlanPrices,
  getStripe,
  isBillingConfigured,
} from '@/server/stripe';

const TRIAL_DAYS = 14;

function appUrl(path: string): string {
  const baseUrl = env.NEXTAUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return new URL(path, baseUrl).toString();
}

function requireBillingConfigured(): void {
  if (!isBillingConfigured()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Billing is not configured.' });
  }
}

export const billingRouter = router({
  /**
   * The Realm's current plan. Readable by any member; only the owner may start
   * checkout or open the portal.
   */
  getPlan: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'MEMBER');
      const subscription = await ctx.db.subscription.findUnique({
        where: { realmId: input.realmId },
        select: {
          status: true,
          priceId: true,
          stripeSubscriptionId: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      });
      const plan = planFromSubscription(subscription, getPlanPrices());

      return {
        plan,
        limits: PLAN_LIMITS[plan],
        status: subscription?.status ?? null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        hasSubscription: hasLiveSubscription(subscription),
        hasBillingAccount: Boolean(subscription),
        canManage: role === 'OWNER',
        billingConfigured: isBillingConfigured(),
        paidPlansAvailable: arePaidPlansAvailable(),
      };
    }),

  /**
   * Record that the caller pressed a paid plan's subscribe button while paid
   * plans are "coming soon". Any signed-in user may call it; repeats are no-ops.
   */
  registerInterest: protectedProcedure
    .input(z.object({ plan: z.enum(['pro', 'business']) }))
    .mutation(async ({ ctx, input }) => {
      await recordPlanInterest(ctx.db, ctx.user.id, input.plan);
      return { ok: true as const };
    }),

  /**
   * Start a Stripe-hosted Checkout for a paid plan. The client names a plan,
   * never a price; access is granted later by the webhook, not by the redirect.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        realmId: z.string().uuid(),
        plan: z.enum(['pro', 'business']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'OWNER');
      requireBillingConfigured();
      if (!arePaidPlansAvailable()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Paid plans are coming soon.',
        });
      }
      const price = getPlanPrices()[input.plan]!;
      const stripe = getStripe();

      let subscription = await ctx.db.subscription.findUnique({
        where: { realmId: input.realmId },
      });
      if (hasLiveSubscription(subscription)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This Realm already has a subscription. Change it from the billing portal.',
        });
      }

      if (!subscription) {
        const realm = await ctx.db.realm.findUniqueOrThrow({
          where: { id: input.realmId },
          select: { name: true },
        });
        // The idempotency key collapses double-clicks and concurrent requests
        // onto one Stripe customer per Realm.
        const customer = await stripe.customers.create(
          {
            name: realm.name,
            metadata: { realmId: input.realmId },
          },
          { idempotencyKey: `realm-customer:${input.realmId}` },
        );
        // INCOMPLETE until the webhook reports a real subscription, so this
        // placeholder row never grants a paid plan.
        subscription = await ctx.db.subscription.upsert({
          where: { realmId: input.realmId },
          create: {
            realmId: input.realmId,
            stripeCustomerId: customer.id,
            status: 'INCOMPLETE',
          },
          update: {},
        });
      }

      // Our row only learns of a subscription once the webhook lands, so ask
      // Stripe too: a checkout just completed in another tab must block this one.
      const existing = await getCustomerSubscriptionState(stripe, subscription.stripeCustomerId);
      if (existing.hasLive) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This Realm already has a subscription. Change it from the billing portal.',
        });
      }
      // Only the newest checkout can be paid, so two open tabs cannot both
      // subscribe.
      await expireOpenCheckoutSessions(stripe, subscription.stripeCustomerId);

      // One trial per Realm: any earlier subscription, even a canceled
      // one, uses it up.
      const trialEligible = !subscription.stripeSubscriptionId && !existing.hasAny;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: subscription.stripeCustomerId,
        client_reference_id: input.realmId,
        line_items: [{ price, quantity: 1 }],
        subscription_data: {
          metadata: { realmId: input.realmId },
          ...(trialEligible && { trial_period_days: TRIAL_DAYS }),
        },
        success_url: appUrl('/settings?tab=billing&checkout=success'),
        cancel_url: appUrl('/settings?tab=billing'),
      });
      if (!session.url) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }
      return { url: session.url };
    }),

  /**
   * Open the Stripe Customer Portal for plan changes, cancellation, invoices
   * and payment methods.
   */
  createPortalSession: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'OWNER');
      requireBillingConfigured();

      const subscription = await ctx.db.subscription.findUnique({
        where: { realmId: input.realmId },
        select: { stripeCustomerId: true },
      });
      if (!subscription) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This Realm has no billing account yet.',
        });
      }

      const session = await getStripe().billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: appUrl('/settings?tab=billing'),
      });
      return { url: session.url };
    }),
});
