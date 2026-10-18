// @vitest-environment node
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ env: {} }));

import { expireOpenCheckoutSessions, getCustomerSubscriptionState } from './stripe';

/** Stripe list calls are async-iterable (auto-pagination). */
function listOf<T>(items: T[]) {
  return vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  }));
}

function fakeStripe({
  subscriptions = [] as { status: string }[],
  sessions = [] as { id: string }[],
  expire = vi.fn(async () => ({})),
} = {}) {
  return {
    subscriptions: { list: listOf(subscriptions) },
    checkout: { sessions: { list: listOf(sessions), expire } },
  } as unknown as Stripe & {
    subscriptions: { list: ReturnType<typeof listOf> };
    checkout: { sessions: { list: ReturnType<typeof listOf>; expire: typeof expire } };
  };
}

describe('getCustomerSubscriptionState', () => {
  it('reports a customer with no subscriptions as free to check out', async () => {
    const stripe = fakeStripe();
    expect(await getCustomerSubscriptionState(stripe, 'cus_1')).toEqual({
      hasLive: false,
      hasAny: false,
    });
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: 'cus_1',
      status: 'all',
      limit: 100,
    });
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid', 'paused'])(
    'treats a %s subscription as live',
    async (status) => {
      const state = await getCustomerSubscriptionState(
        fakeStripe({ subscriptions: [{ status }] }),
        'cus_1',
      );
      expect(state).toEqual({ hasLive: true, hasAny: true });
    },
  );

  it.each(['canceled', 'incomplete', 'incomplete_expired'])(
    'lets a customer with only a %s subscription check out, without a new trial',
    async (status) => {
      const state = await getCustomerSubscriptionState(
        fakeStripe({ subscriptions: [{ status }] }),
        'cus_1',
      );
      expect(state).toEqual({ hasLive: false, hasAny: true });
    },
  );
});

describe('expireOpenCheckoutSessions', () => {
  it("expires every open session of the customer's", async () => {
    const stripe = fakeStripe({ sessions: [{ id: 'cs_1' }, { id: 'cs_2' }] });
    await expireOpenCheckoutSessions(stripe, 'cus_1');
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      customer: 'cus_1',
      status: 'open',
      limit: 100,
    });
    expect(stripe.checkout.sessions.expire.mock.calls).toEqual([['cs_1'], ['cs_2']]);
  });

  it('keeps going when a session completed or expired in the meantime', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const expire = vi
      .fn()
      .mockRejectedValueOnce(new Error('session is not open'))
      .mockResolvedValue({});
    const stripe = fakeStripe({ sessions: [{ id: 'cs_1' }, { id: 'cs_2' }], expire });
    await expect(expireOpenCheckoutSessions(stripe, 'cus_1')).resolves.toBeUndefined();
    expect(expire).toHaveBeenCalledWith('cs_2');
  });
});
