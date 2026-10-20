// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma-generated/prisma/client';
import { lockRealm } from './realm-lock';

// Regression guard for the int8 overflow P0: the advisory-lock key sent to
// Postgres is hash(low62) + 2^62. Masking must happen BEFORE the region
// offset - if it didn't, ~half of all hashes would push the sum past
// 2^63-1 and Postgres would reject the parameter as "value out of range for
// type bigint". The key must always land in the signed int8 range, and in
// this helper's case within the [2^62, 2^63-1] Realm region.
const INT8_MAX = BigInt('9223372036854775807'); // 2^63 - 1
const REALM_REGION_OFFSET = BigInt('4611686018427387904'); // 2^62

async function captureLockKey(realmId: string): Promise<bigint> {
  let captured: bigint | undefined;
  const tx = {
    $executeRaw: vi.fn((_sql: unknown, value?: unknown) => {
      captured = value as bigint;
      return Promise.resolve(1);
    }),
  } as unknown as Prisma.TransactionClient;

  await lockRealm(tx, realmId);
  expect(captured).toBeDefined();
  return captured!;
}

describe('lockRealm advisory key', () => {
  it('stays within signed int8 range across many ids (overflow guard)', async () => {
    // Deterministic pseudo-random ids plus boundary-ish strings so the fold
    // exercises a wide spread of high-bit hashes.
    const ids: string[] = ['realm_0', 'realm_1', 'a', 'ab', 'abcdefghijklmnopqrstuvwxyz'];
    for (let i = 0; i < 5000; i++) {
      ids.push(`realm_${i.toString(36)}_${(i * 2654435761) % 1000000}`);
    }
    for (const id of ids) {
      const key = await captureLockKey(id);
      expect(typeof key).toBe('bigint');
      expect(key <= INT8_MAX).toBe(true);
      expect(key >= REALM_REGION_OFFSET).toBe(true);
    }
  });

  it('passes the raw bigint value to pg_advisory_xact_lock', async () => {
    // The +2^62 region offset keeps Realm keys disjoint-ish from project keys;
    // pin that the value sent is at least the region offset (a missing offset
    // would let Realm locks collide with the project lock space).
    const key = await captureLockKey('realm_1');
    expect(key >= REALM_REGION_OFFSET).toBe(true);
  });
});
