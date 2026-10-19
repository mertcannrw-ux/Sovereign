// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-generated/prisma/client';
import { ensurePersonalRealm } from './onboarding';

interface RecordedWrites {
  realms: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
}

/**
 * Minimal Prisma double: enough to prove which rows the helper writes and that
 * the pre-transaction / in-transaction checks behave differently.
 */
function createDbMock(options: {
  existing?: { id: string } | null;
  afterTransaction?: { id: string } | null;
}) {
  const writes: RecordedWrites = { realms: [], auditEvents: [] };
  let lookups = 0;

  const db = {
    realm: {
      findFirst: vi.fn(async () => {
        lookups += 1;
        // First call is the pre-transaction check; later calls model the
        // in-transaction re-check that guards concurrent sign-ins.
        return lookups === 1 ? (options.existing ?? null) : (options.afterTransaction ?? null);
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const realm = { id: `realm-${writes.realms.length + 1}`, ...args.data };
        writes.realms.push(realm);
        return realm;
      }),
    },
    auditEvent: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        writes.auditEvents.push(args.data);
        return args.data;
      }),
    },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  };

  return { db: db as unknown as PrismaClient, writes, dbMock: db };
}

describe('ensurePersonalRealm', () => {
  it('is a no-op when the user already has a personal Realm', async () => {
    const { db, writes, dbMock } = createDbMock({ existing: { id: 'realm-existing' } });

    await expect(ensurePersonalRealm(db, 'user-1')).resolves.toBe('realm-existing');
    expect(dbMock.realm.findFirst).toHaveBeenCalledWith({
      where: { ownerId: 'user-1', type: 'PERSONAL' },
      select: { id: true },
    });
    expect(writes.realms).toHaveLength(0);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('creates a personal Realm with an OWNER membership and an audit event', async () => {
    const { db, writes } = createDbMock({});

    await expect(ensurePersonalRealm(db, 'user-2', 'ip-hash')).resolves.toBe('realm-1');

    expect(writes.realms).toEqual([
      expect.objectContaining({
        name: 'Personal',
        type: 'PERSONAL',
        ownerId: 'user-2',
        members: { create: { userId: 'user-2', role: 'OWNER' } },
      }),
    ]);
    expect(writes.auditEvents).toEqual([
      expect.objectContaining({
        realmId: 'realm-1',
        actorId: 'user-2',
        action: 'realm.created',
        targetType: 'realm',
        ipHash: 'ip-hash',
      }),
    ]);
  });

  it('serializes provisioning per user with an advisory lock', async () => {
    const { db, dbMock } = createDbMock({});
    await ensurePersonalRealm(db, 'user-3');
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns the Realm created by a concurrent sign-in instead of creating another', async () => {
    const { db, writes } = createDbMock({ afterTransaction: { id: 'realm-raced' } });

    await expect(ensurePersonalRealm(db, 'user-5')).resolves.toBe('realm-raced');
    expect(writes.realms).toHaveLength(0);
  });
});
