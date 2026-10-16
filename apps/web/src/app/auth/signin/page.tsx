'use client';

import { Suspense, useState, type FormEvent } from 'react';

import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { GitBranch, Loader2 } from 'lucide-react';
import { Logo } from '@/components/landing/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-[360px]">
        <Link href="/" aria-label="Sovereign home" className="mb-10 inline-flex">
          <Logo />
        </Link>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Sign in to continue</h1>
          <p className="mt-2 text-sm text-foreground-muted">Welcome back to your workspace.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
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
              required
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Link
                href="/auth/forgot-password"
                className="text-xs text-foreground-muted transition-colors hover:text-foreground"
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
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <Button type="submit" className="mt-2 w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {(oauth.data?.google || oauth.data?.github) && (
          <>
            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-foreground-muted">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-2">
              {oauth.data.google && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleOAuthSignIn('google')}
                  disabled={isGoogleLoading || isGithubLoading}
                >
                  <span className="mr-2 font-semibold">G</span>Continue with Google
                </Button>
              )}
              {oauth.data.github && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleOAuthSignIn('github')}
                  disabled={isGoogleLoading || isGithubLoading}
                >
                  <GitBranch className="mr-2 h-4 w-4" />
                  Continue with GitHub
                </Button>
              )}
            </div>
          </>
        )}
        <p className="mt-10 text-sm text-foreground-muted">
          New to Sovereign?{' '}
          <Link href="/auth/signup" className="text-foreground underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

/** Show a loading fallback while the sign-in form waits for search parameters. */
export default function SignInPage() {
  return (
    <Suspense
      // Without a fallback this page prerenders as an empty shell — it is the
      // only boundary in the app without one, and `useSearchParams` forces the
      // static-render bailout on every build.
      fallback={
        <div className="grid min-h-screen place-items-center bg-background">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
