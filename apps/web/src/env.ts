import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  /**
   * Server-side environment variables.
   * These are never exposed to the client bundle.
   */
  server: {
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    NEXTAUTH_URL: z.string().url().optional(),
    NEXTAUTH_SECRET:
      process.env.NODE_ENV === 'test'
        ? z.string().optional()
        : z.string().min(32, 'NEXTAUTH_SECRET must be at least 32 characters'),
    API_KEY_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'API_KEY_ENCRYPTION_KEY must be 64 hex characters'),

    // Opt-in: when "true", X-Forwarded-For/X-Real-IP are trusted verbatim for
    // rate-limit keying. Only set this behind a reverse proxy that appends the
    // real client IP; a default-on value lets any client mint fresh rate-limit
    // buckets with a forged header.
    // '' is accepted (and treated as false) so a blank `TRUSTED_PROXY=` line -
    // common in copied .env files - doesn't crash startup the way the strict
    // enum would; absent also means false.
    TRUSTED_PROXY: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => v === 'true'),

    // Redis
    REDIS_URL: z.string().url().optional(),

    // OAuth — optional; providers with incomplete credentials won't render in sign-in
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // Upstash Redis (for rate limits / queue)
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    // Cloudflare R2
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    R2_PUBLIC_URL: z.string().url().optional(),

    // E2B
    E2B_API_KEY: z.string().optional(),

    // Vercel
    VERCEL_TOKEN: z.string().optional(),
    VERCEL_ORG_ID: z.string().optional(),
    VERCEL_PROJECT_ID: z.string().optional(),

    // Stripe
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ID_PRO: z.string().optional(),
    STRIPE_PRICE_ID_BUSINESS: z.string().optional(),

    // Transactional email (Resend)
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),

    // WorkOS (SAML SSO)
    WORKOS_API_KEY: z.string().optional(),
    WORKOS_CLIENT_ID: z.string().optional(),

    // GitHub App
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),

    // Observability
    SENTRY_DSN: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  },

  /**
   * Client-side environment variables.
   * Only these are exposed to the browser bundle.
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
    NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: z.string().optional(),
  },

  /**
   * Map environment variables to their runtime values.
   */
  runtimeEnv: {
    TRUSTED_PROXY: process.env.TRUSTED_PROXY,

    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    API_KEY_ENCRYPTION_KEY: process.env.API_KEY_ENCRYPTION_KEY,

    REDIS_URL: process.env.REDIS_URL,

    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,

    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,

    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,

    E2B_API_KEY: process.env.E2B_API_KEY,

    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,

    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO,
    STRIPE_PRICE_ID_BUSINESS: process.env.STRIPE_PRICE_ID_BUSINESS,

    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,

    WORKOS_API_KEY: process.env.WORKOS_API_KEY,
    WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,

    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET,

    SENTRY_DSN: process.env.SENTRY_DSN,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,

    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: process.env.NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW,
  },

  /**
   * Skip validation during build when database isn't available.
   * The env will be validated at runtime on first access.
   */
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
});
