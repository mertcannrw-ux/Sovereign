'use client';

import { Suspense, useState, type FormEvent } from 'react';

import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Command, GitBranch, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
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
    <main className="grid min-h-screen bg-background lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative hidden overflow-hidden border-r border-border p-12 lg:flex lg:flex-col">
        <div className="landing-grid absolute inset-0 opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(184,255,90,.13),transparent_35%)]" />
        <Link href="/" className="relative z-10 flex items-center gap-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/30">
            <Command className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="text-base font-bold uppercase tracking-[0.22em] text-foreground">
            Sovereign
          </span>
        </Link>
        <div className="relative z-10 my-auto max-w-xl">
          <p className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Sparkles className="h-4 w-4" />
            Independent by design
          </p>
          <h1 className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.055em] xl:text-6xl">
            Build with AI.
            <br />
            <span className="text-white/35">Own every line.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-foreground-muted">
            Your models, your credentials, and a production-ready codebase you can take anywhere.
          </p>
          <ul className="mt-10 space-y-4 text-sm text-foreground-secondary">
            {[
              'Use any supported AI provider',
              'Export or sync your complete codebase',
              'No credits, markups, or platform lock-in',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-primary">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 flex items-center gap-2 text-xs text-foreground-muted">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Credentials are encrypted at rest
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[430px]">
          <Link
            href="/"
            className="mb-12 flex items-center gap-2 text-sm text-foreground-muted transition-colors hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sovereign
          </Link>
          <div className="mb-9">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Welcome back
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.045em]">Sign in to continue</h2>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">
              Access your projects, providers, and deployment workspace.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-foreground-muted hover:text-primary"
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
              <div
                role="alert"
                className="rounded-lg border border-error/20 bg-error/10 px-3.5 py-3 text-sm text-error"
              >
                {error}
              </div>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          {(oauth.data?.google || oauth.data?.github) && (
            <>
              <div className="my-7 flex items-center gap-4">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.14em] text-foreground-muted">
                  or continue with
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {oauth.data.google && (
                  <Button
                    variant="outline"
                    onClick={() => handleOAuthSignIn('google')}
                    disabled={isGoogleLoading || isGithubLoading}
                  >
                    <span className="mr-2 font-semibold">G</span>Google
                  </Button>
                )}
                {oauth.data.github && (
                  <Button
                    variant="outline"
                    onClick={() => handleOAuthSignIn('github')}
                    disabled={isGoogleLoading || isGithubLoading}
                  >
                    <GitBranch className="mr-2 h-4 w-4" />
                    GitHub
                  </Button>
                )}
              </div>
            </>
          )}
          <p className="mt-8 text-center text-sm text-foreground-muted">
            New to Sovereign?{' '}
            <Link href="/auth/signup" className="font-semibold text-foreground hover:text-primary">
              Create an account
            </Link>
          </p>
        </div>
      </section>
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
