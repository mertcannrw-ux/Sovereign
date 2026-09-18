import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma-generated/prisma/client';

// ─── Helpers ──────────────────────────────────────────────

/**
 * Slugify an organization name. Mirrors `generateSlug` in
 * `lib/trpc/routers/organizations.ts` so onboarding-provisioned workspaces and
 * user-created ones share one slug scheme.
 */
function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'organization'
  );
}

/** Bounded retries: the loop must terminate even under (pathological) collisions. */
const SLUG_MAX_ATTEMPTS = 5;

/**
 * Same uniqueness approach as the organizations router (base slug, then a
 * suffix on collision), but bounded: a time-based suffix alone can repeat within
 * the same millisecond, so each retry gets fresh entropy and the final fallback
 * is a full UUID segment.
 */
async function uniqueSlug(
  db: Pick<Prisma.TransactionClient, 'organization'>,
  baseSlug: string,
): Promise<string> {
  for (let attempt = 0; attempt < SLUG_MAX_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${randomUUID().slice(0, 8)}`;
    const taken = await db.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${baseSlug}-${randomUUID()}`;
}

// ─── Public API ───────────────────────────────────────────

/**
 * Make sure `userId` belongs to at least one organization, creating a personal
 * workspace owned by them when they have none, and return its id.
 *
 * `projects.create` requires an organizationId + MEMBER role and nothing in the
 * UI creates an organization, so a brand-new signup would otherwise dead-end at
 * "No workspace found. Create or join an organization first.".
 *
 * Idempotent: a user who already has ANY membership (invited, or provisioned by
 * an earlier sign-in) gets that organizationId back and nothing is written, so
 * this is safe to call from both registration and every sign-in.
 *
 * `ipHash` is the caller's hashed IP when available (tRPC context); OAuth
 * sign-in has none, and the column is nullable.
 */
export async function ensurePersonalOrganization(
  db: PrismaClient,
  userId: string,
  displayName?: string | null,
  ipHash?: string | null,
): Promise<string> {
  const existing = await db.organizationMember.findFirst({
    where: { userId },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing.organizationId;

  const ownerName = displayName?.trim() || 'Personal';
  const name = `${ownerName}'s Workspace`;
  const baseSlug = generateSlug(name);

  return db.$transaction(async (tx) => {
    // Re-check inside the transaction: a first sign-in can be issued
    // concurrently (e.g. two tabs), and without this both would create a
    // workspace for the same user.
    const raced = await tx.organizationMember.findFirst({
      where: { userId },
      select: { organizationId: true },
    });
    if (raced) return raced.organizationId;

    const slug = await uniqueSlug(tx, baseSlug);

    const organization = await tx.organization.create({
      data: { name, slug, ownerId: userId },
    });

    await tx.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId,
        role: 'OWNER',
      },
    });

    // Mirrors organizations.create so an auto-provisioned workspace is
    // audit-visible exactly like a user-created one.
    await tx.auditEvent.create({
      data: {
        organizationId: organization.id,
        actorId: userId,
        action: 'organization.created',
        targetType: 'organization',
        targetId: organization.id,
        ipHash: ipHash ?? null,
      },
    });

    return organization.id;
  });
}
