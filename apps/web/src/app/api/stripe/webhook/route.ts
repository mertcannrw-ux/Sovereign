import type Stripe from 'stripe';
import { NextRequest } from 'next/server';
import { env } from '@/env';
import { getDb } from '@/lib/db';
import { getStripe, syncSubscription } from '@/server/stripe';

export const dynamic = 'force-dynamic';

/**
 * Stripe → server subscription updates.
 *
 * Unauthenticated by design: the Stripe signature over the raw body is the
 * only credential. Every handled event funnels into `syncSubscription`, which
 * re-reads the subscription from Stripe, so handling is idempotent and safe
 * under Stripe's at-least-once, unordered delivery.
 */
export async function POST(request: NextRequest) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Billing is not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'Missing signature' }, { status: 400 });

  // The signature covers the exact bytes Stripe sent, so read the body as text
  // and verify before parsing anything.
  const body = await request.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const subscriptionId = subscriptionIdFor(event);
  if (!subscriptionId) return Response.json({ received: true });

  try {
    await syncSubscription(getDb(), stripe, subscriptionId);
  } catch (error) {
    // A 5xx makes Stripe retry with backoff.
    console.error(`[stripe] Failed to sync ${event.type} ${event.id}`, error);
    return Response.json({ error: 'Sync failed' }, { status: 500 });
  }
  return Response.json({ received: true });
}

function subscriptionIdFor(event: Stripe.Event): string | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const { subscription } = event.data.object;
      if (!subscription) return null;
      return typeof subscription === 'string' ? subscription : subscription.id;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return event.data.object.id;
    default:
      return null;
  }
}
