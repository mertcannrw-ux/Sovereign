import { describe, expect, it } from 'vitest';
import { safeCallbackUrl, withCallback } from './safe-callback';

describe('safeCallbackUrl', () => {
  it('keeps a path on this site', () => {
    expect(safeCallbackUrl('/invite/abc')).toBe('/invite/abc');
    expect(safeCallbackUrl('/project/1?tab=comments')).toBe('/project/1?tab=comments');
  });

  it('falls back for anything that could leave the site', () => {
    for (const raw of [
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'javascript:x',
      '',
      // Pass the raw-string checks but normalize to a protocol-relative path.
      '/.//evil.test',
      '/%2e//evil.test',
      '/foo/..//evil.test',
    ]) {
      expect(safeCallbackUrl(raw)).toBe('/dashboard');
    }
    expect(safeCallbackUrl(null)).toBe('/dashboard');
  });
});

describe('withCallback', () => {
  it('carries a non-default callback along', () => {
    expect(withCallback('/auth/signup', '/invite/abc')).toBe(
      '/auth/signup?callbackUrl=%2Finvite%2Fabc',
    );
    expect(withCallback('/auth/signup', '/dashboard')).toBe('/auth/signup');
  });
});
