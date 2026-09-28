import { afterEach, describe, expect, it, vi } from 'vitest';
import { AXE_SCRIPT_PATH, EDITOR_SCRIPT_PATH } from '@/lib/visual-editor';
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
  PreviewBootCancelledError,
  replacePreviewAssetUrls,
  scheduleViteReadyFallback,
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
  it('defaults on: Vite preview is used whenever package.json exists', () => {
    expect(isVitePreviewEnabled({})).toBe(true);
    expect(shouldBootVite([{ path: 'package.json' }], {})).toBe(true);
  });

  it('uses the static engine when Vite is opted out or no package.json exists', () => {
    const envOff = { SOVEREIGN_VITE_PREVIEW: '0' };
    expect(shouldBootVite([{ path: 'package.json' }], envOff)).toBe(false);
    expect(shouldBootVite([{ path: 'src/App.tsx' }], {})).toBe(false);
    expect(hasPackageJson([{ path: './package.json' }])).toBe(true);
  });

  it('treats "0" and "false" as explicit opt-outs', () => {
    expect(isVitePreviewEnabled({ SOVEREIGN_VITE_PREVIEW: '0' })).toBe(false);
    expect(isVitePreviewEnabled({ SOVEREIGN_VITE_PREVIEW: 'false' })).toBe(false);
    expect(isVitePreviewEnabled({ NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: '0' })).toBe(false);
    expect(isVitePreviewEnabled({ NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: 'false' })).toBe(false);
  });

  it('accepts the legacy "1" flag values as an explicit opt-in', () => {
    expect(isVitePreviewEnabled({ NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: '1' })).toBe(true);
    expect(isVitePreviewEnabled({ SOVEREIGN_VITE_PREVIEW: '1' })).toBe(true);
  });
});

describe('preview overlay', () => {
  it('writes WC-only overlay files at non-dot URLs Vite can serve', () => {
    const files = getPreviewOverlayFiles();
    expect(files.map((file) => file.path)).toEqual([
      '__sovereign_edit.js',
      'public/__sovereign_edit.js',
      '__sovereign_axe.js',
      'public/__sovereign_axe.js',
      '.sovereign-preview.mjs',
    ]);
    expect(files.every((file) => isSovereignOverlayPath(file.path))).toBe(true);
    expect(isSovereignOverlayPath('src/App.tsx')).toBe(false);
    expect(PREVIEW_JS_DISCLOSURE).toContain('isolated iframe');
    expect(files.find((file) => file.path.endsWith('__sovereign_axe.js'))?.content).toContain(
      'axe-core is not vendored',
    );
  });

  it('re-patches index.html with editor and axe tags without mutating other files', () => {
    const files = overlayPreviewFiles([
      {
        path: 'index.html',
        content: '<!doctype html><html><body><div id="root"></div></body></html>',
      },
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

function mockHost(options?: { installExit?: number; viteExit?: number; viteSpawnError?: Error }): {
  host: PreviewProcessHost;
  spawns: Array<{ command: string; args: string[] }>;
} {
  const spawns: Array<{ command: string; args: string[] }> = [];
  const host: PreviewProcessHost = {
    async spawn(command, args) {
      spawns.push({ command, args });
      if (command === 'npm') return mockProcess(Promise.resolve(options?.installExit ?? 0));
      if (command === 'npx') {
        if (options?.viteSpawnError) throw options.viteSpawnError;
        return mockProcess(
          options?.viteExit === undefined
            ? new Promise(() => {})
            : Promise.resolve(options.viteExit),
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
    const result = await startPreviewProcess(host, {
      mode: 'static',
      onLog: (line) => logs.push(line),
    });

    expect(result.engine).toBe('static');
    expect(result.fallbackError).toBeUndefined();
    expect(spawns).toEqual([{ command: 'node', args: ['.sovereign-preview.mjs'] }]);
  });

  it('flag on: npm install --ignore-scripts then npx vite --host', async () => {
    const { host, spawns } = mockHost();
    const logs: string[] = [];
    const result = await startPreviewProcess(host, {
      mode: 'vite',
      onLog: (line) => logs.push(line),
    });

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
    const result = await startPreviewProcess(host, {
      mode: 'vite',
      onLog: (line) => logs.push(line),
    });

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

  it('never spawns Vite when the owner went away during npm install', async () => {
    // The page unmounts while `npm install` runs. Spawning Vite anyway leaves a
    // server nobody owns on 5173, which the *next* project's preview adopts as
    // its own URL (the stale-preview bug this guards).
    let cancelled = false;
    const installExit = Promise.withResolvers<number>();
    const spawns: Array<{ command: string; args: string[] }> = [];
    const host: PreviewProcessHost = {
      async spawn(command, args) {
        spawns.push({ command, args });
        if (command === 'npm') {
          return { exit: installExit.promise, output: emptyOutput(), kill: vi.fn() };
        }
        return mockProcess(new Promise(() => {}));
      },
    };

    const boot = startPreviewProcess(host, {
      mode: 'vite',
      onLog: () => {},
      isCancelled: () => cancelled,
    });
    expect(spawns).toEqual([{ command: 'npm', args: ['install', '--ignore-scripts'] }]);

    cancelled = true;
    installExit.resolve(0);

    await expect(boot).rejects.toThrow(PreviewBootCancelledError);
    expect(spawns).toEqual([{ command: 'npm', args: ['install', '--ignore-scripts'] }]);
  });

  it('kills a server that starts as its owner goes away instead of falling back', async () => {
    let cancelled = false;
    const { host, spawns } = mockHost();
    const hostWithLateCancel: PreviewProcessHost = {
      spawn: async (command, args) => {
        const process = await host.spawn(command, args);
        cancelled = true;
        return process;
      },
    };

    await expect(
      startPreviewProcess(hostWithLateCancel, {
        mode: 'static',
        onLog: () => {},
        isCancelled: () => cancelled,
      }),
    ).rejects.toThrow(PreviewBootCancelledError);

    // No second server: the abandoned static process is killed, and the Vite
    // fallback path must not spawn one either.
    expect(spawns).toEqual([{ command: 'node', args: ['.sovereign-preview.mjs'] }]);
  });

  it('does not spawn anything when the boot is already cancelled', async () => {
    const { host, spawns } = mockHost();
    await expect(
      startPreviewProcess(host, { mode: 'static', onLog: () => {}, isCancelled: () => true }),
    ).rejects.toThrow(PreviewBootCancelledError);
    await expect(
      startPreviewProcess(host, { mode: 'vite', onLog: () => {}, isCancelled: () => true }),
    ).rejects.toThrow(PreviewBootCancelledError);

    expect(spawns).toEqual([]);
  });

  it('reuses the live static server when npm install fails instead of spawning a second one', async () => {
    const existing = mockProcess();
    const { host, spawns } = mockHost({ installExit: 1 });
    const logs: string[] = [];
    const result = await startPreviewProcess(host, {
      mode: 'vite',
      onLog: (line) => logs.push(line),
      existingStatic: existing,
    });

    expect(result.engine).toBe('static');
    expect(result.reusedExisting).toBe(true);
    expect(result.process).toBe(existing);
    expect(spawns).toEqual([{ command: 'npm', args: ['install', '--ignore-scripts'] }]);
    expect(logs.at(-1)).toMatch(/Keeping the static file server/);
  });

  it('reuses the live static server when Vite spawn throws', async () => {
    const existing = mockProcess();
    const { host, spawns } = mockHost({ viteSpawnError: new Error('vite not found') });
    const result = await startPreviewProcess(host, {
      mode: 'vite',
      onLog: () => {},
      existingStatic: existing,
    });

    expect(result.process).toBe(existing);
    expect(result.reusedExisting).toBe(true);
    expect(spawns).toEqual([
      { command: 'npm', args: ['install', '--ignore-scripts'] },
      { command: 'npx', args: ['vite', '--host'] },
    ]);
  });
});

describe('scheduleViteReadyFallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back when Vite exits before ready', async () => {
    vi.useFakeTimers();
    const process = mockProcess(Promise.resolve(1));
    const onFallback = vi.fn();
    scheduleViteReadyFallback(process, {
      timeoutMs: 30_000,
      isCurrent: () => true,
      onLog: () => {},
      onFallback,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it('falls back when Vite never becomes ready', async () => {
    vi.useFakeTimers();
    const process = mockProcess(new Promise(() => {}));
    const onFallback = vi.fn();
    scheduleViteReadyFallback(process, {
      timeoutMs: 30_000,
      isCurrent: () => true,
      onLog: () => {},
      onFallback,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(process.kill).toHaveBeenCalled();
  });

  it('does not fall back after cancel (server-ready)', async () => {
    vi.useFakeTimers();
    const process = mockProcess(new Promise(() => {}));
    const onFallback = vi.fn();
    const cancel = scheduleViteReadyFallback(process, {
      timeoutMs: 30_000,
      isCurrent: () => true,
      onLog: () => {},
      onFallback,
    });
    cancel();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onFallback).not.toHaveBeenCalled();
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
