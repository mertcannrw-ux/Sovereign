import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Next.js resolves env files from the app directory, not the workspace root, so
// `.env.example` is copied to `apps/web/.env`. Load that first and fall back to
// a root `.env` (e.g. for CI or legacy setups). dotenv never overrides variables
// that are already set, so `apps/web/.env` wins.
config({ path: ['apps/web/.env', '.env'] });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
