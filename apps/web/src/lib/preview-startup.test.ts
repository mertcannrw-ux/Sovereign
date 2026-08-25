import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPreviewAssetUrls,
  getPreviewSupportFiles,
  mergePreviewFiles,
  replacePreviewAssetUrls,
  withTimeout,
} from '@/lib/preview-startup';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a startup result before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 100, 'timed out')).resolves.toBe('ready');
  });

  it('fails a stalled startup and runs its cleanup', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const result = withTimeout(new Promise<never>(() => {}), 30_000, 'Preview stalled', cleanup);
    const assertion = expect(result).rejects.toThrow('Preview stalled');

    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe('getPreviewSupportFiles', () => {
  it('adds the automatic React JSX runtime for incomplete TSX projects', () => {
    expect(
      getPreviewSupportFiles([
        { path: 'package.json', content: '{}' },
        { path: 'src/main.tsx', content: '<App />' },
      ]),
    ).toEqual([
      {
        path: 'tsconfig.json',
        content: JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }, null, 2),
      },
    ]);
  });

  it('does not override a project TypeScript configuration', () => {
    expect(
      getPreviewSupportFiles([
        { path: 'src/main.tsx', content: '<App />' },
        { path: 'tsconfig.app.json', content: '{}' },
      ]),
    ).toEqual([]);
  });
});

describe('mergePreviewFiles', () => {
  it('keeps generated project files when boot support layers use the same path', () => {
    expect(
      mergePreviewFiles(
        [{ path: 'tsconfig.json', content: '{"compilerOptions":{"jsx":"preserve"}}' }],
        [{ path: 'tsconfig.json', content: '{"compilerOptions":{"jsx":"react-jsx"}}' }],
      ),
    ).toEqual([{ path: 'tsconfig.json', content: '{"compilerOptions":{"jsx":"preserve"}}' }]);
  });
});

describe('preview asset URL materialization helpers', () => {
  it('deduplicates local asset URLs and replaces only successful downloads', () => {
    const first = 'http://localhost:3000/api/assets/projects/p/a.png?expires=1&sig=abc';
    const second = 'http://localhost:3000/api/assets/projects/p/b.webp?expires=2&sig=def';
    const content = `<img src="${first}" /><div style="background-image:url(${second})"></div><img src="${first}" />`;

    expect(getPreviewAssetUrls(content)).toEqual([first, second]);
    expect(
      replacePreviewAssetUrls(
        content,
        new Map([
          [first, '/__sovereign_assets/a.png'],
          [second, '/__sovereign_assets/b.webp'],
        ]),
      ),
    ).toBe(
      '<img src="/__sovereign_assets/a.png" /><div style="background-image:url(/__sovereign_assets/b.webp)"></div><img src="/__sovereign_assets/a.png" />',
    );
  });
});
