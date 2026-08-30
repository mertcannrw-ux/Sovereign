'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Command, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';

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
      const result = await signIn('credentials', { email: email.trim(), password, redirect: false });
      if (result?.ok) router.push('/dashboard');
      else setError('Account created. Sign in to continue.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[430px]">
        <Link href="/auth/signin" className="mb-12 flex items-center gap-2 text-sm text-foreground-muted transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Back to sign in
        </Link>
        <div className="mb-9">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Get started</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-0.045em]">Create an account</h2>
          <p className="mt-3 text-sm leading-6 text-foreground-muted">
            Use email and password. OAuth is optional and only shown when configured.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">Name</label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">Email address</label>
            <Input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="you@company.com" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <Input id="password" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} placeholder="At least 8 characters" autoComplete="new-password" required />
          </div>
          {error && <div role="alert" className="rounded-lg border border-error/20 bg-error/10 px-3.5 py-3 text-sm text-error">{error}</div>}
          <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-foreground-muted">
          <Command className="h-4 w-4" />
          Already have an account?{' '}
          <Link href="/auth/signin" className="font-semibold text-foreground hover:text-primary">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
