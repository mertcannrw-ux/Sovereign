'use client';

import { Suspense, useState, type FormEvent } from 'react';

import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import {
  AuthShell,
  AuthShellFallback,
  FormError,
  fieldInput,
  fieldLabel,
  oauthButton,
  submitButton,
} from '@/components/auth/auth-shell';
import { primaryButton } from '@/components/landing/primitives';
import { GITHUB_MARK, GOOGLE_MARK, ProviderMark } from '@/components/landing/provider-logos';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';

/** Monochrome sign-in marks from simple-icons (CC0), on the same 24x24 grid as `PROVIDER_LOGOS`. */
/**
 * NextAuth redirects OAuth failures back to the sign-in page with `?error=`.
 * Map the codes we can produce to actionable copy; unknown codes fall back to a
 * generic message rather than showing a raw identifier.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  AccountLinkRequired:
    'An account with this email already exists and uses a password. Sign in with your password instead; for security we do not link social logins to password-protected accounts automatically.',
  EmailNotVerified:
    'Your social provider has not verified this email address, so it cannot be used to sign in.',
  ProviderNotConnected:
    'An account with this email already exists. Sign in the way you usually do, then connect this provider in Settings.',
  OAuthAccountNotLinked:
    'An account with this email already exists. Sign in with the method you originally used.',
  AccessDenied: 'Access was denied by the provider.',
  Configuration: 'Sign-in is misconfigured on the server. Please contact support.',
};

/** Render credential and OAuth sign-in controls with errors from the URL or sign-in attempt. */
function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(
    oauthError ? (OAUTH_ERROR_MESSAGES[oauthError] ?? 'Sign-in failed. Please try again.') : '',
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const oauth = trpc.auth.providers.useQuery();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setIsLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.ok) router.push('/dashboard');
      else setError(result?.error ?? 'Invalid email or password.');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOAuthSignIn(provider: string) {
    if (provider === 'google') setIsGoogleLoading(true);
    if (provider === 'github') setIsGithubLoading(true);
    await signIn(provider, { callbackUrl: '/dashboard' });
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to continue"
      copy="Access your projects, providers, and deployment workspace."
      aside={{ href: '/auth/signup', label: 'Create account' }}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className={fieldLabel}>
            Email address
          </label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            error={!!error}
            autoComplete="email"
            className={fieldInput}
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className={fieldLabel}>
              Password
            </label>
            <Link
              href="/auth/forgot-password"
              className="rounded-sm text-xs text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError('');
            }}
            error={!!error}
            autoComplete="current-password"
            className={fieldInput}
            required
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className={cn(primaryButton, submitButton)} disabled={isLoading}>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {(oauth.data?.google || oauth.data?.github) && (
        <>
          <div className="my-8 flex items-center gap-4">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted">
              or continue with
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {oauth.data.google && (
              <button
                type="button"
                className={oauthButton}
                onClick={() => handleOAuthSignIn('google')}
                disabled={isGoogleLoading || isGithubLoading}
              >
                {isGoogleLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ProviderMark d={GOOGLE_MARK} className="h-4 w-4" />
                )}
                Google
              </button>
            )}
            {oauth.data.github && (
              <button
                type="button"
                className={oauthButton}
                onClick={() => handleOAuthSignIn('github')}
                disabled={isGoogleLoading || isGithubLoading}
              >
                {isGithubLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ProviderMark d={GITHUB_MARK} className="h-4 w-4" />
                )}
                GitHub
              </button>
            )}
          </div>
        </>
      )}
      <p className="mt-10 border-t border-border pt-6 text-sm text-foreground-muted">
        New to Sovereign?{' '}
        <Link href="/auth/signup" className="font-medium text-foreground hover:text-primary">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

/** Show a loading fallback while the sign-in form waits for search parameters. */
export default function SignInPage() {
  return (
    // Without a fallback this page prerenders as an empty shell - it is the
    // only boundary in the app without one, and `useSearchParams` forces the
    // static-render bailout on every build.
    <Suspense fallback={<AuthShellFallback />}>
      <SignInForm />
    </Suspense>
  );
}
