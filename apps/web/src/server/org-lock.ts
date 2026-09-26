import type { Prisma } from '@prisma-generated/prisma/client';

/**
 * Hash an organization ID to a Postgres advisory-lock key (positive signed
 * 64-bit, FNV-like fold). Mirrors `projectIdToAdvisoryKey` in
 * `lib/versioning.ts` but keys on the organization so member offboarding and
 * project creation can serialize against each other per organization.
 */
function orgIdToAdvisoryKey(organizationId: string): bigint {
  const factor = BigInt(31);
  // Fold into the lower 62 bits ([0, 2^62-1]) BEFORE adding the 2^62 region
  // offset (see lockOrganizationMembership). Masking to 2^63-1 first and then
  // adding 2^62 overflows int8 - about half of all hashes land >= 2^62, and
  // Postgres rejects the sum as "value out of range for type bigint". 62 bits
  // of entropy is ample for advisory-lock keying.
  const mask = BigInt('0x3fffffffffffffff'); // 2^62 - 1
  let hash = BigInt(0);
  for (let i = 0; i < organizationId.length; i++) {
    hash = (hash * factor + BigInt(organizationId.charCodeAt(i))) & mask;
  }
  return hash;
}

/**
 * Serialize against concurrent `removeMember` for this organization: both
 * writers take the org advisory lock inside their transaction, so a project
 * created by the departing member cannot slip between the transfer scan and
 * the membership delete (which would leave the removed user owning a project
 * in this organization — `requireProjectRole` grants OWNER from `ownerId`
 * regardless of membership).
 *
 * Lock key space: org keys land in [2^62, 2^63-1] via the +2^62 region offset.
 * `projectIdToAdvisoryKey` folds to [0, 2^63-1], so the two ranges overlap and
 * a project lock could share a key with an org lock. That is only false
 * serialization (different lock domains occasionally waiting on each other),
 * never a correctness or deadlock risk. Prisma exposes no advisory-lock API,
 * so this is raw SQL.
 *
 * The offset MUST stay applied to a value already masked to 2^62-1: adding it
 * to a 63-bit hash overflows int8 and Postgres rejects the query.
 */
export async function lockOrganizationMembership(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${
    orgIdToAdvisoryKey(organizationId) + BigInt('4611686018427387904')
  })`;
}
