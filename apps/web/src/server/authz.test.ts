// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { hasRealmRole, requireProjectAccess, requireRealmRole } from './authz';
import type { AuthzContext } from './authz';

/**
 * Minimal fake of the two Prisma delegates authz touches. Only the query shapes
 * authz actually issues are implemented, so a change in how authz queries the
 * database breaks these tests loudly rather than silently passing.
 */
function makeCtx(options: {
  userId?: string | null;
  project?: { realmId: string; ownerId: string } | null;
  membership?: { role: 'OWNER' | 'ADMIN' | 'MEMBER'; type?: 'PERSONAL' | 'SHARED' } | null;
}): AuthzContext {
  const { userId = 'user-1', project = null, membership = null } = options;

  return {
    user: userId === null ? null : ({ id: userId } as AuthzContext['user']),
    db: {
      project: { findUnique: vi.fn(async () => project) },
      realmMember: {
        findUnique: vi.fn(async () =>
          membership
            ? { role: membership.role, realm: { type: membership.type ?? 'SHARED' } }
            : null,
        ),
      },
    },
  } as unknown as AuthzContext;
}

async function expectTrpcError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(TRPCError);
  await promise.catch((error: TRPCError) => expect(error.code).toBe(code));
}

describe('hasRealmRole', () => {
  it('orders roles MEMBER < ADMIN < OWNER', () => {
    expect(hasRealmRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasRealmRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasRealmRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasRealmRole('ADMIN', 'OWNER')).toBe(false);
  });
});

describe('requireRealmRole', () => {
  it('rejects an anonymous caller', async () => {
    const ctx = makeCtx({ userId: null });
    await expectTrpcError(requireRealmRole(ctx, 'realm-1', 'MEMBER'), 'UNAUTHORIZED');
  });

  it('hides a Realm from non-members behind NOT_FOUND', async () => {
    const ctx = makeCtx({ membership: null });
    await expectTrpcError(requireRealmRole(ctx, 'realm-1', 'MEMBER'), 'NOT_FOUND');
  });

  it('enforces the minimum role', async () => {
    const member = makeCtx({ membership: { role: 'MEMBER' } });
    await expectTrpcError(requireRealmRole(member, 'realm-1', 'ADMIN'), 'FORBIDDEN');

    const admin = makeCtx({ membership: { role: 'ADMIN' } });
    await expect(requireRealmRole(admin, 'realm-1', 'ADMIN')).resolves.toEqual({
      realmId: 'realm-1',
      role: 'ADMIN',
      realmType: 'SHARED',
    });
    await expectTrpcError(requireRealmRole(admin, 'realm-1', 'OWNER'), 'FORBIDDEN');

    const owner = makeCtx({ membership: { role: 'OWNER', type: 'PERSONAL' } });
    await expect(requireRealmRole(owner, 'realm-1', 'OWNER')).resolves.toEqual({
      realmId: 'realm-1',
      role: 'OWNER',
      realmType: 'PERSONAL',
    });
  });
});

describe('requireProjectAccess', () => {
  const project = { realmId: 'realm-1', ownerId: 'creator-1' };

  it('rejects an anonymous caller', async () => {
    const ctx = makeCtx({ userId: null, project });
    await expectTrpcError(requireProjectAccess(ctx, 'proj-1'), 'UNAUTHORIZED');
  });

  it('returns NOT_FOUND for a missing project', async () => {
    const ctx = makeCtx({ project: null });
    await expectTrpcError(requireProjectAccess(ctx, 'missing'), 'NOT_FOUND');
  });

  it("does not let a non-member reach a Realm's project", async () => {
    const ctx = makeCtx({ userId: 'outsider', project, membership: null });
    await expectTrpcError(requireProjectAccess(ctx, 'proj-1'), 'NOT_FOUND');
  });

  it('does not let the creator back in once they have left the Realm', async () => {
    const ctx = makeCtx({ userId: 'creator-1', project, membership: null });
    await expectTrpcError(requireProjectAccess(ctx, 'proj-1'), 'NOT_FOUND');
  });

  it("lets every member open and build the Realm's projects", async () => {
    const ctx = makeCtx({ userId: 'member-1', project, membership: { role: 'MEMBER' } });
    await expect(requireProjectAccess(ctx, 'proj-1')).resolves.toEqual({
      realmId: 'realm-1',
      role: 'MEMBER',
      realmType: 'SHARED',
      ownerId: 'creator-1',
    });
  });

  it('enforces a higher minimum role when asked', async () => {
    const member = makeCtx({ project, membership: { role: 'MEMBER' } });
    await expectTrpcError(requireProjectAccess(member, 'proj-1', 'ADMIN'), 'FORBIDDEN');
    const admin = makeCtx({ project, membership: { role: 'ADMIN' } });
    await expect(requireProjectAccess(admin, 'proj-1', 'ADMIN')).resolves.toMatchObject({
      role: 'ADMIN',
    });
  });
});
