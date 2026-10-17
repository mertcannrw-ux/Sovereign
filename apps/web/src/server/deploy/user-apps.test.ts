// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  env: {
    DEPLOY_DOMAIN: 'apps.example.com',
    DEPLOY_R2_BUCKET: 'user-apps',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
  },
}));

import {
  MAX_BUNDLE_BYTES,
  MAX_FILES,
  contentTypeFor,
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

  it('builds the public URL', () => {
    expect(deployUrl('todo')).toBe('https://todo.apps.example.com');
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
