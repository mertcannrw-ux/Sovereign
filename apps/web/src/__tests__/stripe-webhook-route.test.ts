// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/stripe/webhook/route';
import { getStripe } from '@/server/stripe';

/**
 * The webhook is the only writer of billing state, so it must reject anything
 * Stripe did not sign, and must converge on Stripe's current subscription no
 * matter which event, or in which order, it receives.
 */
const WEBHOOK_SECRET = 'whsec_test_secret';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/env', () => ({
  env: {
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
    STRIPE_PRICE_ID_PRO: 'price_pro',
    STRIPE_PRICE_ID_BUSINESS: 'price_business',
  },
}));
vi.mock('@/lib/db', () => {
  // syncSubscription wraps its read-modify-write in a transaction; the fake
  // client is handed back as its own tx.
  const client = {
    subscription: { findUnique: mocks.findUnique, update: mocks.update },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return { getDb: () => client };
});

const stripe = getStripe();
const retrieve = vi.spyOn(stripe.subscriptions, 'retrieve');
const listSessions = vi.spyOn(stripe.checkout.sessions, 'list');
const expireSession = vi.spyOn(stripe.checkout.sessions, 'expire');

/** Stripe list calls are async-iterable (auto-pagination). */
function listOf<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  } as never;
}

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_new',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_800_000_000 }] },
    ...overrides,
  };
}

function event(type: string, object: Record<string, unknown>) {
  return JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object } });
}

function post(body: string, signature?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const sig =
    signature ??
    stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
  if (sig) headers['stripe-signature'] = sig;
  return POST(
    new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', headers, body }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  retrieve.mockReset();
  listSessions.mockReset().mockReturnValue(listOf([]));
  expireSession.mockReset().mockResolvedValue({} as never);
  mocks.findUnique.mockResolvedValue({
    id: 'row-1',
    stripeSubscriptionId: null,
    updatedAt: new Date(0),
  });
  mocks.update.mockResolvedValue({});
});

describe('POST /api/stripe/webhook', () => {
  it('rejects a missing signature', async () => {
    const res = await post(event('customer.subscription.updated', { id: 'sub_new' }), '');
    expect(res.status).toBe(400);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('rejects a signature made with another secret', async () => {
    const body = event('customer.subscription.updated', { id: 'sub_new' });
    const forged = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: 'whsec_other',
    });
    const res = await post(body, forged);
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects a body altered after signing', async () => {
    const body = event('customer.subscription.updated', { id: 'sub_new' });
    const sig = stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
    const res = await post(body.replace('sub_new', 'sub_evil'), sig);
    expect(res.status).toBe(400);
  });

  it('syncs from the re-fetched subscription, not the event body', async () => {
    retrieve.mockResolvedValue(stripeSubscription() as never);
    const res = await post(
      event('customer.subscription.updated', { id: 'sub_new', status: 'canceled' }),
    );
    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith('sub_new');
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: 'cus_1' } }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: {
        stripeSubscriptionId: 'sub_new',
        priceId: 'price_pro',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(1_800_000_000 * 1000),
        cancelAtPeriodEnd: false,
      },
    });
  });

  it('resolves the subscription from a completed checkout', async () => {
    retrieve.mockResolvedValue(stripeSubscription({ status: 'trialing' }) as never);
    const res = await post(
      event('checkout.session.completed', { id: 'cs_1', subscription: 'sub_new' }),
    );
    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith('sub_new');
    expect(mocks.update.mock.calls[0]?.[0].data.status).toBe('TRIALING');
  });

  it("expires the customer's other open checkouts once one completes", async () => {
    retrieve.mockResolvedValue(stripeSubscription() as never);
    listSessions.mockReturnValue(listOf([{ id: 'cs_other_tab' }]));
    const res = await post(
      event('checkout.session.completed', {
        id: 'cs_1',
        customer: 'cus_1',
        subscription: 'sub_new',
      }),
    );
    expect(res.status).toBe(200);
    expect(listSessions).toHaveBeenCalledWith({ customer: 'cus_1', status: 'open', limit: 100 });
    expect(expireSession).toHaveBeenCalledWith('cs_other_tab');
  });

  it('only expires checkouts on checkout completion', async () => {
    retrieve.mockResolvedValue(stripeSubscription() as never);
    await post(event('customer.subscription.updated', { id: 'sub_new' }));
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('flags a second live subscription for the same customer', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findUnique.mockResolvedValue({
      id: 'row-1',
      stripeSubscriptionId: 'sub_old',
      updatedAt: new Date(0),
    });
    retrieve.mockImplementation((async (id: string) =>
      stripeSubscription({ id, status: 'active' })) as never);
    const res = await post(event('customer.subscription.created', { id: 'sub_new' }));
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('DUPLICATE SUBSCRIPTION'));
    expect(error.mock.calls[0]?.[0]).toContain('sub_old');
  });

  it('does not flag a replacement for an ended subscription', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findUnique.mockResolvedValue({
      id: 'row-1',
      stripeSubscriptionId: 'sub_old',
      updatedAt: new Date(0),
    });
    retrieve.mockImplementation((async (id: string) =>
      stripeSubscription({ id, status: id === 'sub_old' ? 'canceled' : 'active' })) as never);
    const res = await post(event('customer.subscription.created', { id: 'sub_new' }));
    expect(res.status).toBe(200);
    expect(error).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0]?.[0].data.stripeSubscriptionId).toBe('sub_new');
  });

  it('ignores customers it did not create', async () => {
    retrieve.mockResolvedValue(stripeSubscription() as never);
    mocks.findUnique.mockResolvedValue(null);
    const res = await post(event('customer.subscription.created', { id: 'sub_new' }));
    expect(res.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not let a late event for an ended subscription overwrite the current one', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'row-1',
      stripeSubscriptionId: 'sub_new',
      updatedAt: new Date(0),
    });
    retrieve.mockResolvedValue(stripeSubscription({ id: 'sub_old', status: 'canceled' }) as never);
    const res = await post(event('customer.subscription.deleted', { id: 'sub_old' }));
    expect(res.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('retries the sync when another webhook commits between the read and the write', async () => {
    const stale = new Date(0);
    const fresh = new Date(1_000);
    mocks.findUnique
      .mockResolvedValueOnce({ id: 'row-1', stripeSubscriptionId: null, updatedAt: stale })
      .mockResolvedValueOnce({ id: 'row-1', stripeSubscriptionId: null, updatedAt: fresh })
      .mockResolvedValueOnce({ id: 'row-1', stripeSubscriptionId: null, updatedAt: fresh })
      .mockResolvedValueOnce({ id: 'row-1', stripeSubscriptionId: null, updatedAt: fresh });
    retrieve.mockResolvedValue(stripeSubscription() as never);

    const res = await post(event('customer.subscription.updated', { id: 'sub_new' }));

    expect(res.status).toBe(200);
    // One write after the retry, not one for each snapshot.
    expect(mocks.update).toHaveBeenCalledTimes(1);
    // initial customer resolution + one snapshot per attempt.
    expect(retrieve).toHaveBeenCalledTimes(3);
  });

  it('acknowledges events it does not handle', async () => {
    const res = await post(event('invoice.paid', { id: 'in_1' }));
    expect(res.status).toBe(200);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('returns 500 so Stripe retries when the sync fails', async () => {
    retrieve.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(event('customer.subscription.updated', { id: 'sub_new' }));
    expect(res.status).toBe(500);
  });
});
