import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AXE_SCRIPT_PATH,
  EDITOR_SCRIPT_PATH,
} from '@/lib/visual-editor';
import {
  formatForwardedPreviewError,
  getPreviewAssetUrls,
  getPreviewOverlayFiles,
  getPreviewSupportFiles,
  hasPackageJson,
  isSovereignOverlayPath,
  isVitePreviewEnabled,
  mergePreviewFiles,
  overlayPreviewFiles,
  PREVIEW_JS_DISCLOSURE,
  replacePreviewAssetUrls,
  shouldBootVite,
  startPreviewProcess,
  subscribePreviewDiagnostics,
  withTimeout,
  type PreviewProcess,
  type PreviewProcessHost,
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

describe('SOVEREIGN_VITE_PREVIEW flag', () => {
  it('defaults off', () => {
    expect(isVitePreviewEnabled({})).toBe(false);
    expect(shouldBootVite([{ path: 'package.json' }], {})).toBe(false);
  });

  it('boots Vite only when the flag is on and package.json exists', () => {
    const env = { SOVEREIGN_VITE_PREVIEW: '1' };
    expect(shouldBootVite([{ path: 'src/App.tsx' }], env)).toBe(false);
    expect(shouldBootVite([{ path: 'package.json' }], env)).toBe(true);
    expect(hasPackageJson([{ path: './package.json' }])).toBe(true);
  });

  it('also accepts NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW', () => {
    expect(isVitePreviewEnabled({ NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: '1' })).toBe(true);
  });
});

describe('preview overlay', () => {
  it('writes WC-only overlay files and never uses ProjectFile-looking paths without .sovereign', () => {
    const files = getPreviewOverlayFiles();
    expect(files.map((file) => file.path)).toEqual([
      '.sovereign-edit.js',
      '.sovereign/axe.js',
      '.sovereign-preview.mjs',
    ]);
    expect(files.every((file) => isSovereignOverlayPath(file.path))).toBe(true);
    expect(PREVIEW_JS_DISCLOSURE).toContain('isolated iframe');
  });

  it('re-patches index.html with editor and axe tags without mutating other files', () => {
    const files = overlayPreviewFiles([
      { path: 'index.html', content: '<!doctype html><html><body><div id="root"></div></body></html>' },
      { path: 'src/main.tsx', content: 'createRoot()' },
    ]);
    expect(files[0]?.content).toContain(`<script src="${EDITOR_SCRIPT_PATH}"></script>`);
    expect(files[0]?.content).toContain(`<script src="${AXE_SCRIPT_PATH}"></script>`);
    expect(overlayPreviewFiles(files)[0]?.content).toBe(files[0]?.content);
    expect(files[1]?.content).toBe('createRoot()');
  });
});

function emptyOutput(): ReadableStream<string> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function mockProcess(exit: Promise<number> = new Promise(() => {})): PreviewProcess {
  return {
    exit,
    output: emptyOutput(),
    kill: vi.fn(),
  };
}

function mockHost(options?: {
  installExit?: number;
  viteExit?: number;
  viteSpawnError?: Error;
}): { host: PreviewProcessHost; spawns: Array<{ command: string; args: string[] }> } {
  const spawns: Array<{ command: string; args: string[] }> = [];
  const host: PreviewProcessHost = {
    async spawn(command, args) {
      spawns.push({ command, args });
      if (command === 'npm') return mockProcess(Promise.resolve(options?.installExit ?? 0));
      if (command === 'npx') {
        if (options?.viteSpawnError) throw options.viteSpawnError;
        return mockProcess(
          options?.viteExit === undefined ? new Promise(() => {}) : Promise.resolve(options.viteExit),
        );
      }
      return mockProcess(new Promise(() => {}));
    },
  };
  return { host, spawns };
}

describe('startPreviewProcess', () => {
  it('flag off: spawns the static file server only', async () => {
    const { host, spawns } = mockHost();
    const logs: string[] = [];
    const result = await startPreviewProcess(host, { mode: 'static', onLog: (line) => logs.push(line) });

    expect(result.engine).toBe('static');
    expect(result.fallbackError).toBeUndefined();
    expect(spawns).toEqual([{ command: 'node', args: ['.sovereign-preview.mjs'] }]);
  });

  it('flag on: npm install --ignore-scripts then npx vite --host', async () => {
    const { host, spawns } = mockHost();
    const logs: string[] = [];
    const result = await startPreviewProcess(host, { mode: 'vite', onLog: (line) => logs.push(line) });

    expect(result.engine).toBe('vite');
    expect(result.fallbackError).toBeUndefined();
    expect(spawns).toEqual([
      { command: 'npm', args: ['install', '--ignore-scripts'] },
      { command: 'npx', args: ['vite', '--host'] },
    ]);
    expect(logs.some((line) => line.includes('npx vite --host'))).toBe(true);
  });

  it('falls back to the static server when npm install fails', async () => {
    const { host, spawns } = mockHost({ installExit: 1 });
    const logs: string[] = [];
    const result = await startPreviewProcess(host, { mode: 'vite', onLog: (line) => logs.push(line) });

    expect(result.engine).toBe('static');
    expect(result.fallbackError).toMatch(/npm install --ignore-scripts failed \(exit 1\)/);
    expect(spawns).toEqual([
      { command: 'npm', args: ['install', '--ignore-scripts'] },
      { command: 'node', args: ['.sovereign-preview.mjs'] },
    ]);
    expect(logs.at(-1)).toMatch(/Falling back to the static file server/);
  });

  it('falls back to the static server when Vite spawn throws', async () => {
    const { host, spawns } = mockHost({ viteSpawnError: new Error('vite not found') });
    const result = await startPreviewProcess(host, { mode: 'vite', onLog: () => {} });

    expect(result.engine).toBe('static');
    expect(result.fallbackError).toBe('vite not found');
    expect(spawns).toEqual([
      { command: 'npm', args: ['install', '--ignore-scripts'] },
      { command: 'npx', args: ['vite', '--host'] },
      { command: 'node', args: ['.sovereign-preview.mjs'] },
    ]);
  });

  it('falls back when Vite exits immediately with a non-zero code', async () => {
    const { host, spawns } = mockHost({ viteExit: 1 });
    const result = await startPreviewProcess(host, { mode: 'vite', onLog: () => {} });

    expect(result.engine).toBe('static');
    expect(result.fallbackError).toMatch(/Vite exited with code 1/);
    expect(spawns.at(-1)).toEqual({ command: 'node', args: ['.sovereign-preview.mjs'] });
  });
});

describe('preview diagnostics', () => {
  it('forwards WC error and preview-message events into logs', () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const logs: string[] = [];
    const containerErrors: string[] = [];
    subscribePreviewDiagnostics(
      {
        on(event, listener) {
          listeners.set(event, listener as (...args: never[]) => void);
        },
      },
      (line) => logs.push(line),
      (message) => containerErrors.push(message),
    );

    listeners.get('error')?.({ message: 'SharedArrayBuffer unavailable' } as never);
    listeners.get('preview-message')?.({ type: 'UNCAUGHT_EXCEPTION', message: 'boom' } as never);

    expect(logs).toEqual([
      '[webcontainer] SharedArrayBuffer unavailable',
      '[preview UNCAUGHT_EXCEPTION] boom',
    ]);
    expect(containerErrors).toEqual(['SharedArrayBuffer unavailable']);
    expect(formatForwardedPreviewError({ type: 'UNHANDLED_REJECTION', message: 'nope' })).toBe(
      '[preview UNHANDLED_REJECTION] nope',
    );
  });
});
