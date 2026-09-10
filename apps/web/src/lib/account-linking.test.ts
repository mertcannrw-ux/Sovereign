// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canAdoptAccountByEmail } from './account-linking';

/**
 * Guards the OAuth account pre-hijacking fix. There is no email-verification
 * flow, so anyone can register an arbitrary address with a password. If an
 * OAuth sign-in adopted such a row, the attacker's password would keep working
 * on the victim's account.
 */
describe('canAdoptAccountByEmail', () => {
  it('refuses to adopt an account that has a password (pre-hijack)', () => {
    expect(canAdoptAccountByEmail({ passwordHash: '$2b$12$somebcrypthash' })).toBe(false);
  });

  it('allows adopting an account created by an earlier social sign-in', () => {
    expect(canAdoptAccountByEmail({ passwordHash: null })).toBe(true);
  });
});
