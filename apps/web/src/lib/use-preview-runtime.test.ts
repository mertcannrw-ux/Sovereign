// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeCommandResult } from '@/lib/runtime-commands';
import { usePreviewRuntime } from '@/lib/use-preview-runtime';

/**
 * The runtime bridge is the one place where a wrong order silently ships a
 * broken run: the command must spawn *after* the container has been reconciled
 * with the project's file set, and the result must reach the server with the
 * exit code the sandbox produced. These tests drive the hook with a fake
 * WebContainer so that order, tree state and payload are observable without a
 * browser.
 */
const container = vi.hoisted(() => {
  const events: string[] = [];
  const files = new Map<string, string>();

  /** Node-like `readdir(..., { withFileTypes: true })` over the flat file map. */
  function dirents(directory: string) {
    const prefix = directory === '.' ? '' : `${directory}/`;
    const names = new Map<string, boolean>();
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      const name = slash < 0 ? rest : rest.slice(0, slash);
      names.set(name, (names.get(name) ?? false) || slash >= 0);
    }
    return [...names].map(([name, isDir]) => ({
      name,
      isFile: () => !isDir,
      isDirectory: () => isDir,
    }));
  }

  return {
    events,
    files,
    spawn: vi.fn(async (command: string, args: string[]) => {
      events.push(`spawn:${[command, ...args].join(' ')}`);
      return {
        exit: Promise.resolve(0),
        output: new ReadableStream<string>({
          start(controller) {
            controller.enqueue('tsc: no errors\n');
            controller.close();
          },
        }),
        kill: vi.fn(),
      };
    }),
    fs: {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, String(content));
        events.push(`write:${path}`);
      }),
      rm: vi.fn(async (path: string) => {
        files.delete(path);
        events.push(`rm:${path}`);
      }),
      readdir: vi.fn(async (directory: string) => dirents(directory)),
    },
    on: vi.fn(() => () => undefined),
    teardown: vi.fn(async () => undefined),
  };
});

vi.mock('@webcontainer/api', () => ({
  WebContainer: { boot: vi.fn(async () => container) },
}));

function runtimeFetch() {
  const calls: { url: string; body: RuntimeCommandResult | undefined }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : '';
    // The test owns the payload it produced; parse it as the wire type it is.
    const body = raw ? (JSON.parse(raw) as RuntimeCommandResult) : undefined;
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return { calls, fetchMock };
}

function renderRuntime() {
  return renderHook(() =>
    usePreviewRuntime({ initialFiles: [], enabled: false, projectId: 'project-1' }),
  );
}

describe('usePreviewRuntime runtime bridge', () => {
  beforeEach(() => {
    container.events.length = 0;
    container.files.clear();
    container.spawn.mockClear();
    container.fs.mkdir.mockClear();
    container.fs.writeFile.mockClear();
    container.fs.rm.mockClear();
    container.fs.readdir.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flushes preview writes, spawns the allowlisted argv and posts the result', async () => {
    const { calls, fetchMock } = runtimeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderRuntime();

    act(() => {
      // A streamed file still sitting in the 120 ms preview queue when the run
      // arrives — the command must not start before it is on disk.
      result.current.applyFilePreview({
        operation: 'update',
        path: 'src/App.tsx',
        content: 'export const App = () => null;',
      });
    });

    await act(async () => {
      await result.current.handleRuntimeRequest({
        requestId: 'req-1',
        command: 'npx tsc --noEmit',
        timeoutMs: 120_000,
      });
    });

    expect(container.spawn).toHaveBeenCalledTimes(1);
    expect(container.spawn).toHaveBeenCalledWith('npx', ['tsc', '--noEmit']);
    expect(container.events.indexOf('write:src/App.tsx')).toBeGreaterThanOrEqual(0);
    expect(container.events.indexOf('write:src/App.tsx')).toBeLessThan(
      container.events.indexOf('spawn:npx tsc --noEmit'),
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe('/api/generate/runtime/req-1');
    expect(calls[0]!.body).toMatchObject({
      status: 'complete',
      exitCode: 0,
      output: 'tsc: no errors\n',
    });
  });

  it('reconciles the shared container with the project before spawning', async () => {
    const { calls, fetchMock } = runtimeFetch();
    vi.stubGlobal('fetch', fetchMock);
    // Another project's tree, left behind because this WebContainer instance is
    // shared across every project the browser session opens. `tsc` compiles all
    // of `src`, so these would surface as errors in files this project does not
    // have (the agent cannot read or delete them).
    container.files.set('src/config.ts', 'export const stale = true;');
    container.files.set('src/screens/SettingsScreen.tsx', 'export const Stale = () => null;');
    // Container-owned files that are not part of any project's file set.
    container.files.set('package-lock.json', '{}');
    container.files.set('node_modules/react/index.js', '/* vendor */');
    container.files.set('__sovereign_edit.js', '/* overlay */');
    container.files.set('public/__sovereign_edit.js', '/* overlay */');
    const { result } = renderRuntime();

    act(() => {
      result.current.applyFilePreview({
        operation: 'update',
        path: 'src/App.tsx',
        content: 'export const App = () => null;',
      });
    });

    await act(async () => {
      await result.current.handleRuntimeRequest({
        requestId: 'req-ghosts',
        command: 'npx tsc --noEmit',
        timeoutMs: 120_000,
      });
    });

    expect(container.events).toContain('rm:src/config.ts');
    expect(container.events).toContain('rm:src/screens/SettingsScreen.tsx');
    expect(container.events.indexOf('rm:src/config.ts')).toBeLessThan(
      container.events.indexOf('spawn:npx tsc --noEmit'),
    );
    // The project's own file is (re)written, and nothing the container owns or
    // the preview needs is touched.
    expect(container.events).toContain('write:src/App.tsx');
    const removals = container.events.filter((event) => event.startsWith('rm:'));
    expect(removals).not.toContain('rm:package-lock.json');
    expect(removals).not.toContain('rm:__sovereign_edit.js');
    expect(removals).not.toContain('rm:public/__sovereign_edit.js');
    expect(removals.some((event) => event.startsWith('rm:node_modules/'))).toBe(false);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ status: 'complete' });
  });

  it('refuses an off-allowlist command without spawning anything', async () => {
    const { calls, fetchMock } = runtimeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderRuntime();

    await act(async () => {
      await result.current.handleRuntimeRequest({
        requestId: 'req-2',
        command: 'npx tsc --noEmit; rm -rf /',
        timeoutMs: 120_000,
      });
    });

    expect(container.spawn).not.toHaveBeenCalled();
    expect(calls[0]!.url).toBe('/api/generate/runtime/req-2');
    expect(calls[0]!.body).toMatchObject({ status: 'failed', exitCode: null });
    expect(calls[0]!.body?.error).toContain('not an allowlisted command');
  });

  it('reports a spawn failure as a failed run instead of leaving the server waiting', async () => {
    const { calls, fetchMock } = runtimeFetch();
    vi.stubGlobal('fetch', fetchMock);
    container.spawn.mockRejectedValueOnce(new Error('Only a single WebContainer instance'));
    const { result } = renderRuntime();

    await act(async () => {
      await result.current.handleRuntimeRequest({
        requestId: 'req-3',
        command: 'npm install',
        timeoutMs: 180_000,
      });
    });

    expect(calls[0]!.body).toMatchObject({
      status: 'failed',
      error: 'Only a single WebContainer instance',
    });
  });
});
