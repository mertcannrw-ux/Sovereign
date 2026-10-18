// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  DEPLOY_DOMAIN: 'apps.example.com',
  DEPLOY_R2_BUCKET: 'user-apps',
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
}));
vi.mock('@/env', () => ({ env: mockEnv }));

import {
  MAX_BUNDLE_BYTES,
  MAX_FILES,
  contentTypeFor,
  deployDomainSharesSite,
  deploySubdomain,
  deployUrl,
  validateBundle,
} from './user-apps';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const index = { path: 'index.html', data: b64('<!doctype html>') };

describe('deploySubdomain', () => {
  const id = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';

  it('uses a valid slug as-is', () => {
    expect(deploySubdomain({ id, slug: 'todo-app-1a2b3c4d' })).toBe('todo-app-1a2b3c4d');
  });

  it.each(['api', 'www', 'x'.repeat(64), 'xn--abc', '-bad', 'bad-', 'Upper'])(
    'falls back to an id-derived name for %s',
    (slug) => {
      expect(deploySubdomain({ id, slug })).toBe('app-3f2a9c1e7b4d');
    },
  );

  it("never lets a slug claim another project's id-derived name", () => {
    // The victim's slug is too long, so it is hosted at its fallback name...
    const victim = deploySubdomain({ id, slug: 'x'.repeat(64) });
    expect(victim).toBe('app-3f2a9c1e7b4d');
    // ...and a project deliberately named after it must not land there too.
    const attacker = { id: '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4', slug: victim };
    expect(deploySubdomain(attacker)).toBe('app-9e8d7c6b5a49');
  });

  it('still uses app- slugs that cannot be a fallback name', () => {
    expect(deploySubdomain({ id, slug: 'app-store' })).toBe('app-store');
    expect(deploySubdomain({ id, slug: 'app-3f2a9c1e7b4d5' })).toBe('app-3f2a9c1e7b4d5');
  });

  it('builds the public URL', () => {
    expect(deployUrl('todo')).toBe('https://todo.apps.example.com');
  });
});

describe('deployDomainSharesSite', () => {
  // DEPLOY_DOMAIN is apps.example.com (see the env mock above).
  it.each([
    'https://example.com',
    'https://www.example.com',
    'https://studio.apps.example.com',
    'https://apps.example.com',
  ])('flags %s as the same site', (appUrl) => {
    expect(deployDomainSharesSite([appUrl])).toBe(true);
  });

  it('flags the site when any configured app URL matches', () => {
    expect(deployDomainSharesSite([undefined, 'https://other.dev', 'https://example.com'])).toBe(
      true,
    );
  });

  it.each(['https://example.org', 'https://example-apps.com', 'http://localhost:3000'])(
    'allows %s',
    (appUrl) => {
      expect(deployDomainSharesSite([appUrl])).toBe(false);
    },
  );

  it('allows nothing configured', () => {
    expect(deployDomainSharesSite([undefined, undefined])).toBe(false);
  });

  it('understands multi-label public suffixes', () => {
    mockEnv.DEPLOY_DOMAIN = 'apps.co.uk';
    try {
      // apps.co.uk and studio.co.uk are different registrable domains.
      expect(deployDomainSharesSite(['https://studio.co.uk'])).toBe(false);
      expect(deployDomainSharesSite(['https://www.apps.co.uk'])).toBe(true);
    } finally {
      mockEnv.DEPLOY_DOMAIN = 'apps.example.com';
    }
  });
});

describe('validateBundle', () => {
  it('decodes a valid bundle', () => {
    const files = validateBundle([index, { path: 'assets/app-x1.js', data: b64('ok') }]);
    expect(files.map((f) => f.path)).toEqual(['index.html', 'assets/app-x1.js']);
    expect(Buffer.from(files[1]!.bytes).toString()).toBe('ok');
  });

  it.each(['../evil.js', 'a/../../b.js', '/abs.js', 'a//b.js', 'a\\b.js', 'sp ace.js', './x.js'])(
    'rejects unsafe path %s',
    (path) => {
      expect(() => validateBundle([index, { path, data: b64('x') }])).toThrow(/Invalid file path/);
    },
  );

  it('requires index.html', () => {
    expect(() => validateBundle([{ path: 'app.js', data: b64('x') }])).toThrow(/index\.html/);
  });

  it('rejects empty, duplicate and oversized-count bundles', () => {
    expect(() => validateBundle([])).toThrow(/no files/);
    expect(() => validateBundle([index, index])).toThrow(/Duplicate/);
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ path: `f${i}.js`, data: '' }));
    expect(() => validateBundle(many)).toThrow(/limit/);
  });

  it('rejects bundles over the size cap', () => {
    const big = Buffer.alloc(MAX_BUNDLE_BYTES).toString('base64');
    expect(() => validateBundle([index, { path: 'big.bin', data: big }])).toThrow(/larger/);
  });
});

describe('contentTypeFor', () => {
  it('maps known extensions and defaults the rest', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('assets/a.JS')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('x.unknown')).toBe('application/octet-stream');
  });
});
