import type { PrismaClient } from '@prisma-generated/prisma/client';

/** Every user's own Realm is called this; only they belong to it. */
export const PERSONAL_REALM_NAME = 'Personal';

/**
 * Make sure `userId` has their personal Realm, creating it when missing, and
 * return its id.
 *
 * Keyed on the personal Realm itself, not on any membership: someone who
 * signs up through an invite already belongs to a shared Realm but still gets
 * a place of their own.
 *
 * Idempotent and safe to call from both registration and every sign-in.
 * `ipHash` is the caller's hashed IP when available (tRPC context); OAuth
 * sign-in has none, and the column is nullable.
 */
export async function ensurePersonalRealm(
  db: PrismaClient,
  userId: string,
  ipHash?: string | null,
): Promise<string> {
  const existing = await db.realm.findFirst({
    where: { ownerId: userId, type: 'PERSONAL' },
    select: { id: true },
  });
  if (existing) return existing.id;

  return db.$transaction(async (tx) => {
    // Re-check inside the transaction: a first sign-in can be issued
    // concurrently (e.g. two tabs), and without this both would create a
    // personal Realm. The re-check alone is not a lock under read-committed -
    // both transactions can read "none" - so take a transaction-scoped
    // advisory lock on the user first. That serializes provisioning per user;
    // the second transaction's re-check then sees the first one's commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const raced = await tx.realm.findFirst({
      where: { ownerId: userId, type: 'PERSONAL' },
      select: { id: true },
    });
    if (raced) return raced.id;

    const realm = await tx.realm.create({
      data: {
        name: PERSONAL_REALM_NAME,
        type: 'PERSONAL',
        ownerId: userId,
        members: { create: { userId, role: 'OWNER' } },
      },
    });

    await tx.auditEvent.create({
      data: {
        realmId: realm.id,
        actorId: userId,
        action: 'realm.created',
        targetType: 'realm',
        targetId: realm.id,
        ipHash: ipHash ?? null,
      },
    });

    return realm.id;
  });
}
