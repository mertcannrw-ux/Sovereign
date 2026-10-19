// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

// The routers import @/env (via rate-limit and email), which validates
// process.env at import time; vitest doesn't bootstrap it.
vi.mock('@/env', () => ({
  env: { NEXTAUTH_SECRET: 'a'.repeat(32), NEXTAUTH_URL: 'http://localhost:3000' },
}));

import { encryptApiKey } from '@/lib/crypto';
import type { Context } from '@/lib/trpc/context';
import { apiKeysRouter } from '@/lib/trpc/routers/apiKeys';
import { projectsRouter } from '@/lib/trpc/routers/projects';
import { canManageMember, realmsRouter } from '@/lib/trpc/routers/realms';

/**
 * Permissions are enforced on the server, so these tests call the real tRPC
 * routers as each kind of person, against a small in-memory world:
 *
 *   REALM (shared): OWNER_ID as OWNER, ADMIN_ID as ADMIN, MEMBER_ID as MEMBER
 *   OUTSIDER_ID belongs to no Realm here.
 */

const REALM = '10000000-0000-4000-8000-000000000001';
const OWNER_ID = '20000000-0000-4000-8000-000000000001';
const ADMIN_ID = '20000000-0000-4000-8000-000000000002';
const MEMBER_ID = '20000000-0000-4000-8000-000000000003';
const OUTSIDER_ID = '20000000-0000-4000-8000-000000000004';
const PROJECT = '30000000-0000-4000-8000-000000000001';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

const RAW_KEY = 'sk-live-0123456789abcdefghijklmnop';
const TEST_KEY = '0'.repeat(64);
const originalKey = process.env.API_KEY_ENCRYPTION_KEY;

function world() {
  const members: { realmId: string; userId: string; role: Role }[] = [
    { realmId: REALM, userId: OWNER_ID, role: 'OWNER' },
    { realmId: REALM, userId: ADMIN_ID, role: 'ADMIN' },
    { realmId: REALM, userId: MEMBER_ID, role: 'MEMBER' },
  ];
  const projects = [{ id: PROJECT, realmId: REALM, ownerId: MEMBER_ID, name: 'Landing' }];
  const keys = [
    {
      id: 'key-1',
      realmId: REALM,
      userId: OWNER_ID,
      provider: 'openai',
      encryptedKey: encryptApiKey(RAW_KEY),
      label: null,
      baseUrl: 'https://api.openai.com/v1',
      createdAt: new Date(),
      lastUsedAt: null,
    },
  ];

  const membership = (realmId: string, userId: string) =>
    members.find((m) => m.realmId === realmId && m.userId === userId) ?? null;

  const db = {
    realm: {
      findUniqueOrThrow: vi.fn(async () => ({ name: 'Studio' })),
    },
    realmMember: {
      findUnique: vi.fn(
        async (args: { where: { realmId_userId: { realmId: string; userId: string } } }) => {
          const { realmId, userId } = args.where.realmId_userId;
          const row = membership(realmId, userId);
          return row ? { ...row, realm: { type: 'SHARED' } } : null;
        },
      ),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async (args: { data: { role: Role } }) => ({
        userId: 'x',
        role: args.data.role,
      })),
      delete: vi.fn(async () => ({})),
    },
    realmInvite: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'inv-1',
        ...args.data,
      })),
    },
    apiKey: {
      findMany: vi.fn(async (args: { where: { realmId: string } }) =>
        keys.filter((key) => key.realmId === args.where.realmId),
      ),
      findFirst: vi.fn(async () => keys[0]),
      delete: vi.fn(async () => ({})),
    },
    project: {
      findUnique: vi.fn(
        async (args: { where: { id: string } }) =>
          projects.find((project) => project.id === args.where.id) ?? null,
      ),
      findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => ({
        ...projects.find((project) => project.id === args.where.id)!,
        owner: null,
        realm: null,
      })),
      findMany: vi.fn(async (args: { where: { AND: { realmId?: string }[] } }) => {
        const realmId = args.where.AND.find((clause) => clause.realmId)?.realmId;
        return projects
          .filter((project) => project.realmId === realmId)
          .map((project) => ({ ...project, updatedAt: new Date() }));
      }),
    },
    projectFile: { findMany: vi.fn(async () => []) },
    auditEvent: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return db;
}

function as(userId: string, db = world()) {
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
  return {
    db,
    apiKeys: apiKeysRouter.createCaller(ctx),
    projects: projectsRouter.createCaller(ctx),
    realms: realmsRouter.createCaller(ctx),
  };
}

async function expectCode(promise: Promise<unknown>, code: TRPCError['code']) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = originalKey;
});

describe('raw API keys never reach the client', () => {
  it('lets a member see that a key exists, but not the key, its mask or its endpoint', async () => {
    const keys = await as(MEMBER_ID).apiKeys.list({ realmId: REALM });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ provider: 'openai', maskedKey: null, baseUrl: null });
    const sent = JSON.stringify(keys);
    expect(sent).not.toContain(RAW_KEY);
    expect(sent).not.toContain('encryptedKey');
  });

  it('shows an admin only the masked key, never the plaintext', async () => {
    const [key] = await as(ADMIN_ID).apiKeys.list({ realmId: REALM });
    expect(key?.maskedKey).toBe('sk-...nop');
    expect(JSON.stringify(key)).not.toContain(RAW_KEY);
  });

  it('does not let a member add, test or remove keys', async () => {
    const member = as(MEMBER_ID);
    await expectCode(
      member.apiKeys.save({ realmId: REALM, provider: 'openai', key: 'sk-new' }),
      'FORBIDDEN',
    );
    await expectCode(member.apiKeys.test({ realmId: REALM, id: 'key-1' }), 'FORBIDDEN');
    await expectCode(member.apiKeys.delete({ realmId: REALM, id: 'key-1' }), 'FORBIDDEN');
    expect(member.db.apiKey.delete).not.toHaveBeenCalled();
  });
});

describe("a non-member cannot reach a Realm's projects or keys", () => {
  it('hides the project list, a project, its files and the keys behind NOT_FOUND', async () => {
    const outsider = as(OUTSIDER_ID);
    await expectCode(outsider.projects.list({ realmId: REALM }), 'NOT_FOUND');
    await expectCode(outsider.projects.getById({ id: PROJECT }), 'NOT_FOUND');
    await expectCode(outsider.projects.files({ id: PROJECT }), 'NOT_FOUND');
    await expectCode(outsider.apiKeys.list({ realmId: REALM }), 'NOT_FOUND');
    await expectCode(outsider.realms.listMembers({ realmId: REALM }), 'NOT_FOUND');
    expect(outsider.db.project.findMany).not.toHaveBeenCalled();
  });

  it('cannot create a project in the Realm', async () => {
    await expectCode(
      as(OUTSIDER_ID).projects.create({ realmId: REALM, name: 'Mine now' }),
      'NOT_FOUND',
    );
  });

  it('lets a member open the same projects', async () => {
    const member = as(MEMBER_ID);
    const page = await member.projects.list({ realmId: REALM });
    expect(page.projects.map((project) => project.id)).toEqual([PROJECT]);
    await expect(member.projects.getById({ id: PROJECT })).resolves.toMatchObject({
      id: PROJECT,
      role: 'MEMBER',
    });
  });
});

describe('a member cannot change roles or membership', () => {
  it('rejects role changes, removals and invites from a member', async () => {
    const member = as(MEMBER_ID);
    await expectCode(
      member.realms.updateMemberRole({ realmId: REALM, userId: ADMIN_ID, role: 'MEMBER' }),
      'FORBIDDEN',
    );
    await expectCode(
      member.realms.updateMemberRole({ realmId: REALM, userId: MEMBER_ID, role: 'ADMIN' }),
      'FORBIDDEN',
    );
    await expectCode(member.realms.removeMember({ realmId: REALM, userId: ADMIN_ID }), 'FORBIDDEN');
    await expectCode(
      member.realms.invite({ realmId: REALM, email: 'new@example.com', role: 'MEMBER' }),
      'FORBIDDEN',
    );
    expect(member.db.realmMember.update).not.toHaveBeenCalled();
    expect(member.db.realmMember.delete).not.toHaveBeenCalled();
  });

  it('lets an admin manage members but never touch the owner', async () => {
    const admin = as(ADMIN_ID);
    await expect(
      admin.realms.updateMemberRole({ realmId: REALM, userId: MEMBER_ID, role: 'ADMIN' }),
    ).resolves.toMatchObject({ role: 'ADMIN' });
    await expectCode(
      admin.realms.updateMemberRole({ realmId: REALM, userId: OWNER_ID, role: 'MEMBER' }),
      'FORBIDDEN',
    );
    await expectCode(admin.realms.removeMember({ realmId: REALM, userId: OWNER_ID }), 'FORBIDDEN');
  });

  it('keeps ownership transfer and Realm deletion for the owner', async () => {
    const admin = as(ADMIN_ID);
    await expectCode(
      admin.realms.transferOwnership({ realmId: REALM, newOwnerId: ADMIN_ID }),
      'FORBIDDEN',
    );
    await expectCode(admin.realms.delete({ realmId: REALM }), 'FORBIDDEN');
  });
});

describe('canManageMember', () => {
  it('lets Owner and Admin manage everyone below the owner', () => {
    expect(canManageMember('OWNER', 'ADMIN')).toBe(true);
    expect(canManageMember('ADMIN', 'ADMIN')).toBe(true);
    expect(canManageMember('ADMIN', 'MEMBER')).toBe(true);
    expect(canManageMember('ADMIN', 'OWNER')).toBe(false);
    expect(canManageMember('OWNER', 'OWNER')).toBe(false);
    expect(canManageMember('MEMBER', 'MEMBER')).toBe(false);
  });
});
