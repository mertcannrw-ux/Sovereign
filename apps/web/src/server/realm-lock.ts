import type { Prisma } from '@prisma-generated/prisma/client';

/**
 * Hash a Realm ID to a Postgres advisory-lock key (positive signed 64-bit,
 * FNV-like fold). Mirrors `projectIdToAdvisoryKey` in `lib/versioning.ts` but
 * keys on the Realm.
 */
function realmIdToAdvisoryKey(realmId: string): bigint {
  const factor = BigInt(31);
  // Fold into the lower 62 bits ([0, 2^62-1]) BEFORE adding the 2^62 region
  // offset (see lockRealm). Masking to 2^63-1 first and then adding 2^62
  // overflows int8 - about half of all hashes land >= 2^62, and Postgres
  // rejects the sum as "value out of range for type bigint". 62 bits of
  // entropy is ample for advisory-lock keying.
  const mask = BigInt('0x3fffffffffffffff'); // 2^62 - 1
  let hash = BigInt(0);
  for (let i = 0; i < realmId.length; i++) {
    hash = (hash * factor + BigInt(realmId.charCodeAt(i))) & mask;
  }
  return hash;
}

/**
 * Serialize project creation and member removal within one Realm. Creation
 * re-checks membership and counts projects against the plan limit while
 * holding it, so concurrent creates cannot both pass the limit and a member
 * removed mid-request cannot still add a project.
 *
 * Lock key space: Realm keys land in [2^62, 2^63-1] via the +2^62 region
 * offset. `projectIdToAdvisoryKey` folds to [0, 2^63-1], so the two ranges
 * overlap and a project lock could share a key with a Realm lock. That is only
 * false serialization (different lock domains occasionally waiting on each
 * other), never a correctness or deadlock risk. Prisma exposes no
 * advisory-lock API, so this is raw SQL.
 *
 * The offset MUST stay applied to a value already masked to 2^62-1: adding it
 * to a 63-bit hash overflows int8 and Postgres rejects the query.
 */
export async function lockRealm(tx: Prisma.TransactionClient, realmId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${
    realmIdToAdvisoryKey(realmId) + BigInt('4611686018427387904')
  })`;
}
