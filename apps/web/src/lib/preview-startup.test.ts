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
  VITE_DIRECT_ENTRY_PATH,
  VITE_INSTALL_STAMP_PATH,
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

/** A process whose exit never settles, like a live dev server. */
function pendingExit(): Promise<number> {
  const { promise } = Promise.withResolvers<number>();
  return promise;
}

function mockProcess(exit: Promise<number> = pendingExit()): PreviewProcess {
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
  /** Serve the direct-entry existence probe. */
  viteEntry?: boolean;
  directExit?: number;
  directSpawnError?: Error;
  /** Content returned for the install stamp; omit for "no stamp". */
  stamp?: string;
}): {
  host: PreviewProcessHost;
  spawns: Array<{ command: string; args: string[] }>;
  writes: Array<{ path: string; content: string }>;
} {
  const spawns: Array<{ command: string; args: string[] }> = [];
  const writes: Array<{ path: string; content: string }> = [];
  const host: PreviewProcessHost = {
    async spawn(command, args) {
      spawns.push({ command, args });
      if (command === 'npm') return mockProcess(Promise.resolve(options?.installExit ?? 0));
      if (command === 'node' && args[0] === VITE_DIRECT_ENTRY_PATH) {
        if (options?.directSpawnError) throw options.directSpawnError;
        return mockProcess(
          options?.directExit === undefined ? pendingExit() : Promise.resolve(options.directExit),
        );
      }
      if (command === 'npx') {
        if (options?.viteSpawnError) throw options.viteSpawnError;
        return mockProcess(
          options?.viteExit === undefined ? pendingExit() : Promise.resolve(options.viteExit),
        );
      }
      return mockProcess(pendingExit());
    },
    readFile:
      options?.stamp === undefined
        ? undefined
        : async (path) => (path === VITE_INSTALL_STAMP_PATH ? options.stamp ?? null : null),
    writeFile: async (path, content) => {
      writes.push({ path, content });
    },
    exists:
      options?.viteEntry === undefined
        ? undefined
        : async (path) => options.viteEntry === true && path === VITE_DIRECT_ENTRY_PATH,
  };
  return { host, spawns, writes };
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
        return mockProcess();
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

  it('prefers the direct vite entry over npx when it is installed', async () => {
    const { host, spawns, writes } = mockHost({ viteEntry: true });
    const logs: string[] = [];
    const packageJson = '{"dependencies":{"vite":"6.3.5"}}';
    const result = await startPreviewProcess(host, {
      mode: 'vite',
      onLog: (line) => logs.push(line),
      packageJson,
    });

    expect(result.engine).toBe('vite');
    expect(spawns).toEqual([
      { command: 'npm', args: ['install', '--ignore-scripts'] },
      { command: 'node', args: [VITE_DIRECT_ENTRY_PATH, '--host'] },
    ]);
    // A successful install records the stamp so the next boot can skip it.
    expect(writes).toEqual([{ path: VITE_INSTALL_STAMP_PATH, content: packageJson }]);
  });

  it('retries with npx when the direct entry spawn fails', async () => {
    const { host, spawns } = mockHost({ viteEntry: true, directSpawnError: new Error('EIO') });
    const result = await startPreviewProcess(host, { mode: 'vite', onLog: () => {} });

    expect(result.engine).toBe('vite');
    expect(spawns).toEqual([
      { command: 'npm', args: ['install', '--ignore-scripts'] },
      { command: 'node', args: [VITE_DIRECT_ENTRY_PATH, '--host'] },
      { command: 'npx', args: ['vite', '--host'] },
    ]);
  });

  it('retries with npx when the direct entry exits immediately', async () => {
    const { host, spawns } = mockHost({ viteEntry: true, directExit: 1 });
    const result = await startPreviewProcess(host, { mode: 'vite', onLog: () => {} });

    expect(result.engine).toBe('vite');
    expect(spawns.at(-1)).toEqual({ command: 'npx', args: ['vite', '--host'] });
  });

  it('skips npm install when the stamp matches the project package.json', async () => {
    const packageJson = '{"dependencies":{"vite":"6.3.5"}}';
    const { host, spawns, writes } = mockHost({ viteEntry: true, stamp: packageJson });
    const logs: string[] = [];
    const result = await startPreviewProcess(host, {
      mode: 'vite',
      onLog: (line) => logs.push(line),
      packageJson,
    });

    expect(result.engine).toBe('vite');
    expect(spawns).toEqual([{ command: 'node', args: [VITE_DIRECT_ENTRY_PATH, '--host'] }]);
    expect(writes).toEqual([]);
    expect(logs.some((line) => line.includes('Skipping npm install'))).toBe(true);
  });

  it('reinstalls when the stamp does not match the project package.json', async () => {
    const { host, spawns, writes } = mockHost({ viteEntry: true, stamp: '{"dependencies":{}}' });
    const packageJson = '{"dependencies":{"lucide-react":"1.0.0"}}';
    await startPreviewProcess(host, { mode: 'vite', onLog: () => {}, packageJson });

    expect(spawns[0]).toEqual({ command: 'npm', args: ['install', '--ignore-scripts'] });
    expect(writes).toEqual([{ path: VITE_INSTALL_STAMP_PATH, content: packageJson }]);
  });

  it('reinstalls when the stamp matches but the installed entry is missing', async () => {
    // The stamp is never invalidated, so a match alone must not be trusted: a
    // wiped node_modules has to be rebuilt instead of leaving `npx` to fetch
    // floating packages on top of missing app dependencies.
    const packageJson = '{"dependencies":{"vite":"6.3.5"}}';
    const { host, spawns, writes } = mockHost({ viteEntry: false, stamp: packageJson });
    await startPreviewProcess(host, { mode: 'vite', onLog: () => {}, packageJson });

    expect(spawns[0]).toEqual({ command: 'npm', args: ['install', '--ignore-scripts'] });
    expect(writes).toEqual([{ path: VITE_INSTALL_STAMP_PATH, content: packageJson }]);
  });

  it('skips the install on a host without an exists probe when the stamp matches', async () => {
    const packageJson = '{"dependencies":{"vite":"6.3.5"}}';
    const { host, spawns } = mockHost({ stamp: packageJson });
    const result = await startPreviewProcess(host, { mode: 'vite', onLog: () => {}, packageJson });

    expect(result.engine).toBe('vite');
    expect(spawns).toEqual([{ command: 'npx', args: ['vite', '--host'] }]);
  });

  it('installs without a stamp when the caller provides no package.json content', async () => {
    // Guards the "stamp present but content unknown" case: guessing from a
    // stale stamp could boot Vite against uninstalled dependencies.
    const { host, spawns } = mockHost({ viteEntry: true, stamp: '{"dependencies":{"vite":"6.3.5"}}' });
    await startPreviewProcess(host, { mode: 'vite', onLog: () => {} });

    expect(spawns[0]).toEqual({ command: 'npm', args: ['install', '--ignore-scripts'] });
  });

  it('does not write the stamp when npm install fails', async () => {
    const { host, writes } = mockHost({ installExit: 1 });
    const result = await startPreviewProcess(host, {
      mode: 'vite',
      onLog: () => {},
      packageJson: '{"dependencies":{}}',
    });

    expect(result.engine).toBe('static');
    expect(writes).toEqual([]);
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
    const process = mockProcess();
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
    const process = mockProcess();
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
    const previewErrors: string[] = [];
    subscribePreviewDiagnostics(
      {
        on(event, listener) {
          listeners.set(event, listener as (...args: never[]) => void);
        },
      },
      (line) => logs.push(line),
      (message) => containerErrors.push(message),
      (line) => previewErrors.push(line),
    );

    listeners.get('error')?.({ message: 'SharedArrayBuffer unavailable' } as never);
    listeners.get('preview-message')?.({ type: 'UNCAUGHT_EXCEPTION', message: 'boom' } as never);

    expect(logs).toEqual([
      '[webcontainer] SharedArrayBuffer unavailable',
      '[preview UNCAUGHT_EXCEPTION] boom',
    ]);
    expect(containerErrors).toEqual(['SharedArrayBuffer unavailable']);
    // Only preview (iframe) messages feed the agent: container errors are
    // infrastructure, not application failures.
    expect(previewErrors).toEqual(['[preview UNCAUGHT_EXCEPTION] boom']);
    expect(formatForwardedPreviewError({ type: 'UNHANDLED_REJECTION', message: 'nope' })).toBe(
      '[preview UNHANDLED_REJECTION] nope',
    );
  });

  it('describes console errors through their args, not [object Object]', () => {
    expect(
      formatForwardedPreviewError({
        type: 'PREVIEW_CONSOLE_ERROR',
        args: ['Error: cannot read x', { code: 500 }, 42],
        stack: 'at App',
      }),
    ).toBe('[preview PREVIEW_CONSOLE_ERROR] Error: cannot read x {"code":500} 42\nat App');

    expect(formatForwardedPreviewError({ type: 'PREVIEW_CONSOLE_ERROR', args: [] })).toBe(
      '[preview PREVIEW_CONSOLE_ERROR]',
    );
  });
});
