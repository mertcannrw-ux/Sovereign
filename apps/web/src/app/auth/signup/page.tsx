'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import {
  AuthShell,
  FormError,
  fieldInput,
  fieldLabel,
  submitButton,
} from '@/components/auth/auth-shell';
import { primaryButton } from '@/components/landing/primitives';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';
import { safeCallbackUrl } from '@/lib/safe-callback';

export default function SignUpPage() {
  const router = useRouter();
  const register = trpc.auth.register.useMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please enter an email and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setIsLoading(true);
    try {
      await register.mutateAsync({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
      });
      const result = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
      });
      // Read at submit time: an invite link sends people here with a callback.
      const callbackUrl = safeCallbackUrl(
        new URLSearchParams(window.location.search).get('callbackUrl'),
      );
      if (result?.ok) router.push(callbackUrl);
      else setError('Account created. Sign in to continue.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create an account"
      copy="Use email and password. OAuth is optional and only shown when configured."
      aside={{ href: '/auth/signin', label: 'Sign in' }}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="name" className={fieldLabel}>
            Name
          </label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className={fieldInput}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className={fieldLabel}>
            Email address
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            placeholder="you@company.com"
            autoComplete="email"
            className={fieldInput}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className={fieldLabel}>
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError('');
            }}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            className={fieldInput}
            required
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className={cn(primaryButton, submitButton)} disabled={isLoading}>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {isLoading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-10 border-t border-border pt-6 text-sm text-foreground-muted">
        Already have an account?{' '}
        <Link href="/auth/signin" className="font-medium text-foreground hover:text-primary">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
