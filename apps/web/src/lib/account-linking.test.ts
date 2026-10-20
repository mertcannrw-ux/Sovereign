// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canAdoptAccountByEmail, canRemoveSignInMethod } from './account-linking';

/**
 * Guards the OAuth account pre-hijacking fix. Anyone can register an arbitrary
 * address with a password. If an OAuth sign-in adopted such a row, the
 * attacker's password would keep working on the victim's account.
 */
describe('canAdoptAccountByEmail', () => {
  it('refuses to adopt an account that has a password (pre-hijack)', () => {
    expect(
      canAdoptAccountByEmail({ passwordHash: '$2b$12$somebcrypthash', linkedAccounts: 0 }),
    ).toBe(false);
  });

  it('allows adopting an account created by an earlier social sign-in', () => {
    expect(canAdoptAccountByEmail({ passwordHash: null, linkedAccounts: 0 })).toBe(true);
  });

  it('refuses to adopt an account whose providers are managed in settings', () => {
    expect(canAdoptAccountByEmail({ passwordHash: null, linkedAccounts: 1 })).toBe(false);
  });
});

describe('canRemoveSignInMethod', () => {
  it('keeps the last remaining method', () => {
    expect(canRemoveSignInMethod({ hasPassword: false, linkedAccounts: 1 })).toBe(false);
    expect(canRemoveSignInMethod({ hasPassword: true, linkedAccounts: 0 })).toBe(false);
  });

  it('allows removing one of several methods', () => {
    expect(canRemoveSignInMethod({ hasPassword: true, linkedAccounts: 1 })).toBe(true);
    expect(canRemoveSignInMethod({ hasPassword: false, linkedAccounts: 2 })).toBe(true);
  });
});
