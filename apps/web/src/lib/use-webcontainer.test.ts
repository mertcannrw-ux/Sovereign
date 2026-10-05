// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VITE_DIRECT_ENTRY_PATH, VITE_INSTALL_STAMP_PATH } from '@/lib/preview-startup';
import { useWebContainer } from '@/lib/use-webcontainer';

/**
 * The hook feeds `startPreviewProcess` a host built on the real container FS.
 * These tests drive a Vite boot against a fake WebContainer so the adapters
 * (stamp read/write, direct-entry probe) and the warm-boot recovery are
 * observable without a browser.
 */

const bootMock = vi.hoisted(() => vi.fn());

const container = vi.hoisted(() => {
  const files = new Map<string, string>();
  const spawns: Array<{ command: string; args: string[] }> = [];

  // A fresh, immediately-closed stream per process, like a command with no output.
  function emptyOutput() {
    return new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });
  }

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
    files,
    spawns,
    spawn: vi.fn(async (command: string, args: string[]) => {
      spawns.push({ command, args });
      if (command === 'npm') {
        // The real install is what materialises the dependency tree.
        files.set('node_modules/vite/bin/vite.js', '#!/usr/bin/env node\n');
        return { exit: Promise.resolve(0), output: emptyOutput(), kill: vi.fn() };
      }
      return {
        exit: Promise.withResolvers<number>().promise,
        output: emptyOutput(),
        kill: vi.fn(),
      };
    }),
    fs: {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, String(content));
      }),
      rm: vi.fn(async (path: string) => {
        files.delete(path);
      }),
      readFile: vi.fn(async (path: string, encoding?: string) => {
        void encoding;
        const content = files.get(path);
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return content;
      }),
      readdir: vi.fn(async (directory: string, options?: { withFileTypes?: boolean }) => {
        if (options?.withFileTypes) return dirents(directory);
        // The default `readdir` returns names; the hook's `exists` probe
        // depends on that shape.
        const prefix = directory === '.' ? '' : `${directory}/`;
        const names = new Set<string>();
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          if (!rest) continue;
          const slash = rest.indexOf('/');
          names.add(slash < 0 ? rest : rest.slice(0, slash));
        }
        return [...names];
      }),
    },
    on: vi.fn(() => () => undefined),
    teardown: vi.fn(async () => undefined),
  };
});

vi.mock('@webcontainer/api', () => ({ WebContainer: { boot: bootMock } }));

const packageJson = '{"dependencies":{"vite":"6.3.5"}}';
const viteFiles = [
  { path: 'index.html', content: '<!doctype html><html><body></body></html>' },
  { path: 'package.json', content: packageJson },
];

describe('useWebContainer container FS adapters', () => {
  beforeEach(() => {
    container.files.clear();
    container.spawns.length = 0;
    container.spawn.mockClear();
    container.fs.mkdir.mockClear();
    container.fs.writeFile.mockClear();
    container.fs.rm.mockClear();
    container.fs.readFile.mockClear();
    container.fs.readdir.mockClear();
    bootMock.mockReset();
    bootMock.mockResolvedValue(container);
  });

  it('reads, writes and re-probes the container FS around the install', async () => {
    const { unmount } = renderHook(() => useWebContainer(viteFiles, true));

    await waitFor(() =>
      expect(container.spawn).toHaveBeenCalledWith('node', [VITE_DIRECT_ENTRY_PATH, '--host']),
    );

    // readFile adapter: the stamp probe hits `.sovereign/npm-stamp` first.
    expect(container.fs.readFile).toHaveBeenCalledWith(VITE_INSTALL_STAMP_PATH, 'utf-8');
    // writeFile adapter: the parent directory is created before the stamp lands.
    expect(container.fs.mkdir).toHaveBeenCalledWith('.sovereign');
    expect(container.fs.writeFile).toHaveBeenCalledWith(VITE_INSTALL_STAMP_PATH, packageJson);
    // exists adapter: the entry the fake install materialised is found by
    // listing its parent directory.
    expect(container.fs.readdir).toHaveBeenCalledWith('node_modules/vite/bin');

    unmount();
  });

  it('skips the install on a remount when the stamp and entry survive', async () => {
    const first = renderHook(() => useWebContainer(viteFiles, true));
    await waitFor(() =>
      expect(container.spawns.filter((spawn) => spawn.command === 'npm')).toHaveLength(1),
    );
    first.unmount();

    const second = renderHook(() => useWebContainer(viteFiles, true));
    await waitFor(() =>
      expect(container.spawns.filter((spawn) => spawn.command === 'node')).toHaveLength(2),
    );
    expect(container.spawns.filter((spawn) => spawn.command === 'npm')).toHaveLength(1);
    second.unmount();
  });
});

describe('warmWebContainer', () => {
  it('drops a failed warm boot so the next getContainer() starts a fresh sandbox', async () => {
    // `vi.resetModules()` re-evaluates the hook so its module-level cached boot
    // promise starts empty; a static import cannot be reset, and the module
    // graph is exactly what this regression pins.
    vi.resetModules();
    bootMock.mockReset();
    bootMock
      .mockRejectedValueOnce(new Error('runtime download failed'))
      .mockResolvedValueOnce({ teardown: vi.fn() });
    const { warmWebContainer } = await import('@/lib/use-webcontainer');

    warmWebContainer();
    await vi.waitFor(() => {
      // Each poll joins whatever is cached; once the rejection handler has
      // dropped the failed promise this call boots a second sandbox. With the
      // old `async` wrapper the cache kept the rejected promise, so the count
      // would stay at one forever.
      warmWebContainer();
      expect(bootMock).toHaveBeenCalledTimes(2);
    });
  });
});
