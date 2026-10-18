import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import { env } from '@/env';
import { requireOrganizationRole } from '@/server/authz';
import { PLAN_LIMITS, hasLiveSubscription, planFromSubscription } from '@/server/plans';
import {
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
   * The organization's current plan. Readable by any member; only OWNER/ADMIN
   * may start checkout or open the portal.
   */
  getPlan: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { role } = await requireOrganizationRole(ctx, input.organizationId, 'MEMBER');
      const subscription = await ctx.db.subscription.findUnique({
        where: { organizationId: input.organizationId },
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
        canManage: role === 'OWNER' || role === 'ADMIN',
        billingConfigured: isBillingConfigured(),
      };
    }),

  /**
   * Start a Stripe-hosted Checkout for a paid plan. The client names a plan,
   * never a price; access is granted later by the webhook, not by the redirect.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        plan: z.enum(['pro', 'business']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'ADMIN');
      requireBillingConfigured();
      const price = getPlanPrices()[input.plan]!;
      const stripe = getStripe();

      let subscription = await ctx.db.subscription.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (hasLiveSubscription(subscription)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This workspace already has a subscription. Change it from the billing portal.',
        });
      }

      if (!subscription) {
        const organization = await ctx.db.organization.findUniqueOrThrow({
          where: { id: input.organizationId },
          select: { name: true },
        });
        // The idempotency key collapses double-clicks and concurrent requests
        // onto one Stripe customer per organization.
        const customer = await stripe.customers.create(
          {
            name: organization.name,
            metadata: { organizationId: input.organizationId },
          },
          { idempotencyKey: `org-customer:${input.organizationId}` },
        );
        // INCOMPLETE until the webhook reports a real subscription, so this
        // placeholder row never grants a paid plan.
        subscription = await ctx.db.subscription.upsert({
          where: { organizationId: input.organizationId },
          create: {
            organizationId: input.organizationId,
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
          message: 'This workspace already has a subscription. Change it from the billing portal.',
        });
      }
      // Only the newest checkout can be paid, so two open tabs cannot both
      // subscribe.
      await expireOpenCheckoutSessions(stripe, subscription.stripeCustomerId);

      // One trial per organization: any earlier subscription, even a canceled
      // one, uses it up.
      const trialEligible = !subscription.stripeSubscriptionId && !existing.hasAny;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: subscription.stripeCustomerId,
        client_reference_id: input.organizationId,
        line_items: [{ price, quantity: 1 }],
        subscription_data: {
          metadata: { organizationId: input.organizationId },
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
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'ADMIN');
      requireBillingConfigured();

      const subscription = await ctx.db.subscription.findUnique({
        where: { organizationId: input.organizationId },
        select: { stripeCustomerId: true },
      });
      if (!subscription) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This workspace has no billing account yet.',
        });
      }

      const session = await getStripe().billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: appUrl('/settings?tab=billing'),
      });
      return { url: session.url };
    }),
});
