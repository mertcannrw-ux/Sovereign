// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

// The routers import @/env (via rate-limit and email), which validates
// process.env at import time; vitest doesn't bootstrap it.
vi.mock('@/env', () => ({
  env: { NEXTAUTH_SECRET: 'a'.repeat(32), NEXTAUTH_URL: 'http://localhost:3000' },
}));

import type { Context } from '@/lib/trpc/context';
import { realmsRouter } from '@/lib/trpc/routers/realms';

/**
 * Leaving a Realm (realms.leave) works for every role, and the owner hands the
 * Realm on in the same step. Nobody manages their own membership through
 * removeMember or updateMemberRole.
 */

const REALM = '10000000-0000-4000-8000-000000000001';
const OWNER_ID = '20000000-0000-4000-8000-000000000001';
const ADMIN_ID = '20000000-0000-4000-8000-000000000002';
const MEMBER_ID = '20000000-0000-4000-8000-000000000003';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

function world(type: 'SHARED' | 'PERSONAL' = 'SHARED') {
  const realm = { id: REALM, type, ownerId: OWNER_ID };
  const members: { userId: string; role: Role }[] = [
    { userId: OWNER_ID, role: 'OWNER' },
    { userId: ADMIN_ID, role: 'ADMIN' },
    { userId: MEMBER_ID, role: 'MEMBER' },
  ];
  const find = (userId: string) => members.find((m) => m.userId === userId) ?? null;
  type Where = { where: { realmId_userId: { userId: string } } };

  const db = {
    realm: {
      update: vi.fn(async (args: { data: { ownerId: string } }) => {
        realm.ownerId = args.data.ownerId;
        return realm;
      }),
    },
    realmMember: {
      findUnique: vi.fn(async (args: Where) => {
        const row = find(args.where.realmId_userId.userId);
        return row ? { ...row, realm: { type: realm.type } } : null;
      }),
      update: vi.fn(async (args: Where & { data: { role: Role } }) => {
        find(args.where.realmId_userId.userId)!.role = args.data.role;
        return {};
      }),
      delete: vi.fn(async (args: Where) => {
        members.splice(members.indexOf(find(args.where.realmId_userId.userId)!), 1);
        return {};
      }),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { db, realm, members };
}

function as(userId: string, db: ReturnType<typeof world>['db']) {
  const user = { id: userId, email: `${userId}@example.com`, name: userId };
  const ctx = {
    session: { user, expires: '2099-01-01' },
    user,
    db,
    req: new Request('http://localhost'),
    requestId: 'test',
    ipHash: 'hash',
    userAgent: 'vitest',
  } as unknown as Context;
  return realmsRouter.createCaller(ctx);
}

async function expectCode(promise: Promise<unknown>, code: TRPCError['code']) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('realms.leave', () => {
  it('lets a member and an admin leave', async () => {
    const { db, members } = world();
    await as(MEMBER_ID, db).leave({ realmId: REALM });
    await as(ADMIN_ID, db).leave({ realmId: REALM });
    expect(members.map((m) => m.userId)).toEqual([OWNER_ID]);
  });

  it('makes the owner name the next owner, and hands over as they leave', async () => {
    const { db, realm, members } = world();
    await expectCode(as(OWNER_ID, db).leave({ realmId: REALM }), 'BAD_REQUEST');
    await expectCode(
      as(OWNER_ID, db).leave({ realmId: REALM, newOwnerId: OWNER_ID }),
      'BAD_REQUEST',
    );
    expect(members).toHaveLength(3);

    await as(OWNER_ID, db).leave({ realmId: REALM, newOwnerId: MEMBER_ID });
    expect(realm.ownerId).toBe(MEMBER_ID);
    expect(members).toEqual([
      { userId: ADMIN_ID, role: 'ADMIN' },
      { userId: MEMBER_ID, role: 'OWNER' },
    ]);
  });

  it('refuses a next owner from outside the Realm', async () => {
    const { db, realm, members } = world();
    await expectCode(
      as(OWNER_ID, db).leave({
        realmId: REALM,
        newOwnerId: '20000000-0000-4000-8000-000000000009',
      }),
      'BAD_REQUEST',
    );
    expect(realm.ownerId).toBe(OWNER_ID);
    expect(members).toHaveLength(3);
  });

  it('cannot be used on a personal Realm', async () => {
    const { db, members } = world('PERSONAL');
    await expectCode(as(MEMBER_ID, db).leave({ realmId: REALM }), 'BAD_REQUEST');
    expect(members).toHaveLength(3);
  });
});

describe('nobody manages their own membership', () => {
  it('rejects removing yourself and changing your own role', async () => {
    const { db, members } = world();
    await expectCode(
      as(ADMIN_ID, db).removeMember({ realmId: REALM, userId: ADMIN_ID }),
      'BAD_REQUEST',
    );
    await expectCode(
      as(ADMIN_ID, db).updateMemberRole({ realmId: REALM, userId: ADMIN_ID, role: 'MEMBER' }),
      'BAD_REQUEST',
    );
    expect(members).toEqual([
      { userId: OWNER_ID, role: 'OWNER' },
      { userId: ADMIN_ID, role: 'ADMIN' },
      { userId: MEMBER_ID, role: 'MEMBER' },
    ]);
  });
});
