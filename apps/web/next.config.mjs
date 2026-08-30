import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const prismaGenerated = path.resolve(repoRoot, 'prisma/generated/prisma');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@app-builder/ui',
    '@app-builder/shared',
    '@app-builder/ai-gateway',
    '@app-builder/codegen',
  ],
  serverExternalPackages: ['bcryptjs', '@prisma/adapter-pg', '@prisma/client'],
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      '@prisma-generated/prisma': prismaGenerated,
    },
  },
};

export default nextConfig;
