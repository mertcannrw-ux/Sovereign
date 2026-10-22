import { describe, expect, it, vi } from 'vitest';
import {
  assertCanCreateProject,
  hasLiveSubscription,
  planForPriceId,
  planFromSubscription,
  recordPlanInterest,
} from './plans';

const PRICES = { pro: 'price_pro', business: 'price_business' };

describe('planFromSubscription', () => {
  it('is free without a subscription', () => {
    expect(planFromSubscription(null, PRICES)).toBe('free');
  });

  it('grants the plan for a known price in an access status', () => {
    expect(planFromSubscription({ status: 'ACTIVE', priceId: 'price_pro' }, PRICES)).toBe('pro');
    expect(planFromSubscription({ status: 'TRIALING', priceId: 'price_business' }, PRICES)).toBe(
      'business',
    );
  });

  it.each(['PAST_DUE', 'CANCELED', 'INCOMPLETE'] as const)('is free when %s', (status) => {
    expect(planFromSubscription({ status, priceId: 'price_pro' }, PRICES)).toBe('free');
  });

  it('is free for an unknown or missing price', () => {
    expect(planFromSubscription({ status: 'ACTIVE', priceId: 'price_other' }, PRICES)).toBe('free');
    expect(planFromSubscription({ status: 'ACTIVE', priceId: null }, PRICES)).toBe('free');
  });

  it('never matches an unset price', () => {
    expect(planForPriceId(undefined, {})).toBeNull();
    expect(planForPriceId('price_pro', {})).toBeNull();
  });
});

describe('hasLiveSubscription', () => {
  it('blocks a second checkout while a subscription is live or recoverable', () => {
    for (const status of ['ACTIVE', 'TRIALING', 'PAST_DUE'] as const) {
      expect(hasLiveSubscription({ status, stripeSubscriptionId: 'sub_1' })).toBe(true);
    }
  });

  it('expires with the stored billing period', () => {
    const lapsed = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const current = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(
      hasLiveSubscription({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_1',
        currentPeriodEnd: current,
      }),
    ).toBe(true);
    expect(
      hasLiveSubscription({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_1',
        currentPeriodEnd: lapsed,
      }),
    ).toBe(false);
    // Stripe still retries the charge, so a lapsed PAST_DUE keeps blocking.
    expect(
      hasLiveSubscription({
        status: 'PAST_DUE',
        stripeSubscriptionId: 'sub_1',
        currentPeriodEnd: lapsed,
      }),
    ).toBe(true);
  });

  it('allows checkout for a placeholder or ended subscription', () => {
    expect(hasLiveSubscription(null)).toBe(false);
    expect(hasLiveSubscription({ status: 'INCOMPLETE', stripeSubscriptionId: null })).toBe(false);
    expect(hasLiveSubscription({ status: 'CANCELED', stripeSubscriptionId: 'sub_1' })).toBe(false);
  });
});

describe('assertCanCreateProject', () => {
  function fakeDb(subscription: { status: string; priceId: string | null } | null, active: number) {
    return {
      subscription: { findUnique: vi.fn().mockResolvedValue(subscription) },
      project: { count: vi.fn().mockResolvedValue(active) },
    } as unknown as Parameters<typeof assertCanCreateProject>[0];
  }

  it('allows a free Realm under the limit', async () => {
    await expect(
      assertCanCreateProject(fakeDb(null, 2), 'realm-1', PRICES),
    ).resolves.toBeUndefined();
  });

  it('rejects a free Realm at the limit', async () => {
    await expect(assertCanCreateProject(fakeDb(null, 3), 'realm-1', PRICES)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('does not count projects for a paid Realm', async () => {
    const db = fakeDb({ status: 'ACTIVE', priceId: 'price_pro' }, 50);
    await expect(assertCanCreateProject(db, 'realm-1', PRICES)).resolves.toBeUndefined();
    expect(db.project.count).not.toHaveBeenCalled();
  });

  it('limits a Realm whose payment failed', async () => {
    const db = fakeDb({ status: 'PAST_DUE', priceId: 'price_pro' }, 3);
    await expect(assertCanCreateProject(db, 'realm-1', PRICES)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('recordPlanInterest', () => {
  it('records each user and plan once, ignoring repeat clicks', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { planInterest: { createMany } } as unknown as Parameters<
      typeof recordPlanInterest
    >[0];
    await recordPlanInterest(db, 'user-1', 'pro');
    expect(createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', plan: 'pro' }],
      skipDuplicates: true,
    });
  });
});
