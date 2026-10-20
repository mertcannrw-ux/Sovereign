import { env } from '@/env';

/** True when transactional email (Resend) is configured. */
export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/** Absolute URL for a path in this app, for links in emails. */
export function appUrl(path: string): string {
  const baseUrl = env.NEXTAUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * Send one transactional email through Resend. Returns whether it was accepted.
 *
 * Without a mailer outside production, the message is logged instead (with
 * `devLink` when given) so email flows stay usable locally; callers decide
 * whether `false` is fatal.
 */
export async function sendEmail(message: {
  to: string;
  subject: string;
  html: string;
  devLink?: string;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        `[email] not configured; "${message.subject}" to ${message.to}`,
        message.devLink ?? '',
      );
      return true;
    }
    return false;
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
      }),
    });
    if (!response.ok) console.error('[email] rejected', response.status);
    return response.ok;
  } catch (error) {
    console.error('[email] failed to send', error);
    return false;
  }
}
