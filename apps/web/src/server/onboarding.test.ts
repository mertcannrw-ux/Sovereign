// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-generated/prisma/client';
import { ensurePersonalOrganization } from './onboarding';

// `@/lib/auth` pulls in `@/env`, which validates process.env at import time;
// vitest does not bootstrap the app environment (see rate-limit.test.ts).
vi.mock('@/env', () => ({
  env: { NEXTAUTH_SECRET: 'a'.repeat(32), NEXTAUTH_URL: 'http://localhost:3000' },
}));

interface RecordedWrites {
  organizations: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
}

/**
 * Minimal Prisma double: enough to prove which rows the helper writes and that
 * the pre-transaction / in-transaction membership checks behave differently.
 */
function createDbMock(options: {
  existingMembership?: { organizationId: string } | null;
  membershipAfterTransaction?: { organizationId: string } | null;
  takenSlugs?: string[];
}) {
  const writes: RecordedWrites = { organizations: [], members: [], auditEvents: [] };
  const takenSlugs = new Set(options.takenSlugs ?? []);
  let membershipLookups = 0;

  const db = {
    organizationMember: {
      findFirst: vi.fn(async () => {
        membershipLookups += 1;
        // First call is the pre-transaction check; later calls model the
        // in-transaction re-check that guards concurrent sign-ins.
        return membershipLookups === 1
          ? (options.existingMembership ?? null)
          : (options.membershipAfterTransaction ?? null);
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        writes.members.push(args.data);
        return args.data;
      }),
    },
    organization: {
      findUnique: vi.fn(async (args: { where: { slug: string } }) =>
        takenSlugs.has(args.where.slug) ? { id: 'existing-org' } : null,
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const organization = { id: `org-${writes.organizations.length + 1}`, ...args.data };
        writes.organizations.push(organization);
        return organization;
      }),
    },
    auditEvent: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        writes.auditEvents.push(args.data);
        return args.data;
      }),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  };

  return { db: db as unknown as PrismaClient, writes, dbMock: db };
}

describe('ensurePersonalOrganization', () => {
  it('is a no-op when the user already belongs to any organization', async () => {
    const { db, writes, dbMock } = createDbMock({
      existingMembership: { organizationId: 'org-existing' },
    });

    await expect(ensurePersonalOrganization(db, 'user-1', 'Ada')).resolves.toBe('org-existing');

    expect(writes.organizations).toHaveLength(0);
    expect(writes.members).toHaveLength(0);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('creates an organization, an OWNER membership and an audit event', async () => {
    const { db, writes } = createDbMock({});

    await expect(ensurePersonalOrganization(db, 'user-2', 'Ada', 'ip-hash')).resolves.toBe('org-1');

    expect(writes.organizations).toEqual([
      { id: 'org-1', name: "Ada's Workspace", slug: 'ada-s-workspace', ownerId: 'user-2' },
    ]);
    expect(writes.members).toEqual([{ organizationId: 'org-1', userId: 'user-2', role: 'OWNER' }]);
    expect(writes.auditEvents).toEqual([
      {
        organizationId: 'org-1',
        actorId: 'user-2',
        action: 'organization.created',
        targetType: 'organization',
        targetId: 'org-1',
        ipHash: 'ip-hash',
      },
    ]);
  });

  it("falls back to a 'Personal' workspace name and a null ipHash", async () => {
    const { db, writes } = createDbMock({});

    await ensurePersonalOrganization(db, 'user-3', null);

    expect(writes.organizations[0]?.name).toBe("Personal's Workspace");
    expect(writes.organizations[0]?.slug).toBe('personal-s-workspace');
    expect(writes.auditEvents[0]?.ipHash).toBeNull();
  });

  it('falls back to a suffixed slug when the base slug is taken', async () => {
    const { db, writes } = createDbMock({ takenSlugs: ['ada-s-workspace'] });

    await ensurePersonalOrganization(db, 'user-4', 'Ada');

    const slug = writes.organizations[0]?.slug as string;
    expect(slug).not.toBe('ada-s-workspace');
    expect(slug.startsWith('ada-s-workspace-')).toBe(true);
  });

  it('returns the organization created by a concurrent sign-in instead of creating another', async () => {
    const { db, writes } = createDbMock({
      membershipAfterTransaction: { organizationId: 'org-raced' },
    });

    await expect(ensurePersonalOrganization(db, 'user-5', 'Ada')).resolves.toBe('org-raced');

    expect(writes.organizations).toHaveLength(0);
    expect(writes.members).toHaveLength(0);
  });

  it('leaves the auth module importable (no circular import with lib/auth)', async () => {
    // lib/auth imports this module for the sign-in onboarding hook; the graph
    // must still load at runtime, not just typecheck.
    const auth = await import('@/lib/auth');
    expect(auth.authOptions).toBeDefined();
  });
});
