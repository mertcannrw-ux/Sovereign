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
 * The in-app invite prompt (realms.myInvites / realms.respondToInvite) matches
 * invites to the signed-in account by email, so it must only ever do that for
 * a verified address.
 */

const REALM = '10000000-0000-4000-8000-000000000001';
const INVITE = '40000000-0000-4000-8000-000000000001';
const ADAM = '20000000-0000-4000-8000-000000000002';
const OTTO = '20000000-0000-4000-8000-000000000004';

type Status = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'DECLINED';

function world(options: { verified?: boolean; status?: Status } = {}) {
  const users: Record<string, { email: string; emailVerified: boolean }> = {
    [ADAM]: { email: 'Adam@Example.com', emailVerified: options.verified ?? true },
    [OTTO]: { email: 'otto@example.com', emailVerified: true },
  };
  const invite = {
    id: INVITE,
    realmId: REALM,
    email: 'adam@example.com',
    role: 'ADMIN' as const,
    status: options.status ?? ('PENDING' as Status),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const members: { realmId: string; userId: string; role: string }[] = [];

  // Applies a conditional status write the way Postgres would.
  const updateMany = vi.fn(
    async (args: { where: { id: string; status: Status }; data: { status: Status } }) => {
      if (args.where.id !== invite.id || args.where.status !== invite.status) return { count: 0 };
      invite.status = args.data.status;
      return { count: 1 };
    },
  );

  const db = {
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => users[args.where.id] ?? null),
    },
    realmInvite: {
      findUnique: vi.fn(async (args: { where: { id: string } }) =>
        args.where.id === invite.id ? { ...invite } : null,
      ),
      findMany: vi.fn(async (args: { where: { email: string; status: Status } }) =>
        args.where.email === invite.email && args.where.status === invite.status
          ? [
              {
                id: invite.id,
                role: invite.role,
                realm: { id: REALM, name: 'Acme' },
                invitedBy: { name: 'Olivia', email: 'olivia@example.com' },
              },
            ]
          : [],
      ),
      updateMany,
    },
    realmMember: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async (args: { create: { realmId: string; userId: string; role: string } }) => {
        members.push(args.create);
        return args.create;
      }),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { db, invite, members };
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

describe('realms.myInvites', () => {
  it("lists a verified account's pending invites, matching the address case-insensitively", async () => {
    const { db } = world();
    await expect(as(ADAM, db).myInvites()).resolves.toEqual([
      { id: INVITE, role: 'ADMIN', realmId: REALM, realmName: 'Acme', invitedBy: 'Olivia' },
    ]);
  });

  it('shows nothing to an account whose address is unverified', async () => {
    const { db } = world({ verified: false });
    await expect(as(ADAM, db).myInvites()).resolves.toEqual([]);
    expect(db.realmInvite.findMany).not.toHaveBeenCalled();
  });
});

describe('realms.respondToInvite', () => {
  it('joins the Realm with the invited role on accept', async () => {
    const { db, invite, members } = world();
    await expect(as(ADAM, db).respondToInvite({ inviteId: INVITE, accept: true })).resolves.toEqual(
      { realmId: REALM, joined: true },
    );
    expect(invite.status).toBe('ACCEPTED');
    expect(members).toEqual([{ realmId: REALM, userId: ADAM, role: 'ADMIN' }]);
  });

  it('marks the invite declined without joining on decline', async () => {
    const { db, invite, members } = world();
    await expect(
      as(ADAM, db).respondToInvite({ inviteId: INVITE, accept: false }),
    ).resolves.toEqual({ realmId: REALM, joined: false });
    expect(invite.status).toBe('DECLINED');
    expect(members).toEqual([]);
  });

  it("refuses someone else's invite and an unverified owner alike, as NOT_FOUND", async () => {
    const other = world();
    await expectCode(
      as(OTTO, other.db).respondToInvite({ inviteId: INVITE, accept: true }),
      'NOT_FOUND',
    );
    expect(other.invite.status).toBe('PENDING');

    const unverified = world({ verified: false });
    await expectCode(
      as(ADAM, unverified.db).respondToInvite({ inviteId: INVITE, accept: true }),
      'NOT_FOUND',
    );
    expect(unverified.members).toEqual([]);
  });

  it('cannot decline an invite that was already withdrawn', async () => {
    const { db, invite } = world({ status: 'REVOKED' });
    await expectCode(as(ADAM, db).respondToInvite({ inviteId: INVITE, accept: false }), 'CONFLICT');
    expect(invite.status).toBe('REVOKED');
  });
});

describe('a declined invite link', () => {
  it('no longer works', async () => {
    const { db } = world({ status: 'DECLINED' });
    (db.realmInvite as Record<string, unknown>).findUnique = vi.fn(async () => ({
      id: INVITE,
      realmId: REALM,
      email: 'adam@example.com',
      role: 'ADMIN',
      status: 'DECLINED',
    }));
    await expectCode(as(ADAM, db).acceptInvite({ token: 'whatever' }), 'NOT_FOUND');
  });
});
