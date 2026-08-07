/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@app-builder/ui',
    '@app-builder/shared',
    '@app-builder/ai-gateway',
    '@app-builder/codegen',
  ],
  serverExternalPackages: ['bcryptjs'],
};

export default nextConfig;
