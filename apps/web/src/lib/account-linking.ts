/**
 * Account-linking policy for social sign-in.
 *
 * Kept in its own module (rather than inside `lib/auth.ts`) because `auth.ts`
 * pulls in NextAuth and env validation; this rule is pure and needs to be
 * testable without booting a server environment.
 */

/**
 * Decide whether an OAuth sign-in may adopt an existing row that already owns
 * the signing-in email address.
 *
 * Adopting is safe only when nobody could already be signing in as that row
 * through a credential they supplied. A row with a `passwordHash` fails that
 * test: anyone can register an arbitrary address with a password. Linking a
 * social identity onto such a row would preserve the attacker's password
 * access - classic account pre-hijacking.
 *
 * Rows that already have linked identities are not adopted either: their
 * providers are managed in Settings > Profile, so a provider the user
 * disconnected must not quietly re-link itself on its next sign-in. Rows with
 * neither were created by an OAuth sign-in from before identities were
 * recorded, for the same provider-verified address, so they belong to the same
 * person.
 */
export function canAdoptAccountByEmail(existing: {
  passwordHash: string | null;
  linkedAccounts: number;
}): boolean {
  return existing.passwordHash === null && existing.linkedAccounts === 0;
}

/**
 * Whether one sign-in method may be removed: there must be another one left,
 * or the user locks themselves out.
 */
export function canRemoveSignInMethod(user: {
  hasPassword: boolean;
  linkedAccounts: number;
}): boolean {
  return user.linkedAccounts + (user.hasPassword ? 1 : 0) > 1;
}
