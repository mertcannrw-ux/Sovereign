/**
 * "Connect a sign-in provider" from Settings > Profile.
 *
 * NextAuth's signIn callback does not see the session that started an OAuth
 * round trip, so before redirecting, the signed-in user gets a short-lived
 * cookie naming who is linking which provider. The callback links the OAuth
 * identity to that user only when the cookie is valid AND the browser's session
 * token still belongs to the same user (see lib/auth.ts), so a cookie left
 * behind on a shared machine cannot attach someone else's identity.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const LINK_COOKIE = 'sovereign-link-intent';
export const LINK_TTL_SECONDS = 10 * 60;

export const LINKABLE_PROVIDERS = ['google', 'github'] as const;
export type LinkableProvider = (typeof LINKABLE_PROVIDERS)[number];

export interface LinkIntent {
  userId: string;
  provider: LinkableProvider;
  expiresAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`link:${payload}`).digest('base64url');
}

export function encodeLinkIntent(intent: LinkIntent, secret: string): string {
  const payload = Buffer.from(JSON.stringify(intent)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The intent in `value`, or null when it is malformed, forged or expired. */
export function decodeLinkIntent(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): LinkIntent | null {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const intent = JSON.parse(Buffer.from(payload, 'base64url').toString()) as LinkIntent;
    if (typeof intent.userId !== 'string' || typeof intent.expiresAt !== 'number') return null;
    if (!LINKABLE_PROVIDERS.includes(intent.provider)) return null;
    return intent.expiresAt > now ? intent : null;
  } catch {
    return null;
  }
}
