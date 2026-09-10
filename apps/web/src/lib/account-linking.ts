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
 * test: this app has no email-verification flow, so anyone can register an
 * arbitrary address with a password. Linking a social identity onto such a row
 * would preserve the attacker's password access — classic account
 * pre-hijacking.
 *
 * Rows without a password were created by an earlier OAuth sign-in for the same
 * provider-verified address, so they belong to the same person.
 */
export function canAdoptAccountByEmail(existing: { passwordHash: string | null }): boolean {
  return existing.passwordHash === null;
}
