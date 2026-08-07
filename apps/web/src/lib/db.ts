import { PrismaClient } from '@prisma-generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Get or create the Prisma client singleton.
 * Safe to call at module top-level — defers connection to first query.
 */
export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}

/**
 * Convenience export — calls getDb() on first property access.
 * Use `getDb()` directly if this causes issues.
 */
let _client: PrismaClient | null = null;
export function getDbClient(): PrismaClient {
  if (!_client) _client = getDb();
  return _client;
}
