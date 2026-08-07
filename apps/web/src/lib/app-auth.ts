/**
 * useAuth hook — reference implementation for generated apps.
 *
 * This file serves as a template for the code generation engine that produces
 * authentication logic inside generated applications.  The actual `useAuth`
 * hook in a deployed app wraps a lightweight auth client that talks to the
 * platform's auth endpoints.
 *
 * The types and signatures here document the contract that the code
 * generation engine emits when a user asks for authentication features.
 */

import type { ReactNode } from 'react';

/* ── Types ──────────────────────────────────────────────────── */

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
}

export interface SignInOptions {
  email: string;
  password?: string;
  provider?: 'email' | 'google' | 'github';
}

export interface SignUpOptions {
  email: string;
  password: string;
  name?: string;
}

export interface AuthContextValue extends AuthState {
  signIn: (options: SignInOptions) => Promise<AuthUser>;
  signUp: (options: SignUpOptions) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

/* ── Hook ────────────────────────────────────────────────────── */

/**
 * useAuth — returns the current authentication state and actions.
 *
 * Usage in a generated app:
 * ```tsx
 * import { useAuth } from '@/lib/app-auth';
 *
 * function Dashboard() {
 *   const { user, signOut, isLoading } = useAuth();
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!user) return <Redirect to="/login" />;
 *   return <div>Welcome, {user.name}</div>;
 * }
 * ```
 */
export function useAuth(): AuthContextValue {
  throw new Error(
    'useAuth is a template stub. The code generation engine replaces this ' +
      'file with a real implementation that connects to the platform auth API.',
  );
}

/**
 * useUser — convenience selector that returns only the current user.
 */
export function useUser(): AuthUser | null {
  throw new Error(
    'useUser is a template stub. The code generation engine replaces this ' +
      'file with a real implementation.',
  );
}

/**
 * signIn — standalone function for signing in outside of React components.
 */
export async function signIn(_options: SignInOptions): Promise<AuthUser> {
  throw new Error(
    'signIn is a template stub. The code generation engine replaces this ' +
      'file with a real implementation.',
  );
}

/**
 * signOut — standalone function for signing out outside of React components.
 */
export async function signOut(): Promise<void> {
  throw new Error(
    'signOut is a template stub. The code generation engine replaces this ' +
      'file with a real implementation.',
  );
}

/**
 * AuthProvider — wraps a React tree with auth context.
 */
export function AuthProvider({ children: _children }: { children: ReactNode }): ReactNode {
  throw new Error(
    'AuthProvider is a template stub. The code generation engine replaces this ' +
      'file with a real implementation.',
  );
}
