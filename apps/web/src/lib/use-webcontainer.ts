'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import {
  getPreviewOverlayFiles,
  isIndexHtmlPath,
  isVitePreviewEnabled,
  overlayPreviewFiles,
  PREVIEW_JS_DISCLOSURE,
  shouldBootVite,
  startPreviewProcess,
  subscribePreviewDiagnostics,
  type PreviewEngine,
  type PreviewProcess,
} from '@/lib/preview-startup';

export interface PreviewFile {
  path: string;
  content: string;
}

interface SandboxState {
  status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'error';
  url: string | null;
  logs: string[];
  error: string | null;
  engine: PreviewEngine;
  disclosure: string | null;
}

let containerPromise: Promise<WebContainer> | null = null;

/** Module-level reference so a remount can kill the previous server. */
let previousBootServer: PreviewProcess | null = null;
let diagnosticsAttached = false;
let diagnosticsLog: (line: string) => void = () => {};
let diagnosticsError: (message: string) => void = () => {};

async function getContainer(): Promise<WebContainer> {
  if (!containerPromise) {
    containerPromise = import('@webcontainer/api').then(({ WebContainer }) =>
      WebContainer.boot({ coep: 'require-corp', forwardPreviewErrors: 'exceptions-only' }),
    );
  }
  return containerPromise;
}

async function ensureParentDirectories(container: WebContainer, path: string) {
  const parts = path.split('/').slice(0, -1);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await container.fs.mkdir(current);
    } catch {
      // Directory already exists.
    }
  }
}

function killProcess(process: PreviewProcess | null) {
  if (!process) return;
  try {
    process.kill();
  } catch {
    // Already exited.
  }
}

const PLACEHOLDER_INDEX_HTML =
  '<!doctype html><html><body style="font-family:system-ui;background:#090909;color:white;display:grid;place-items:center;min-height:100vh"><div>Describe what you want to build.</div></body></html>';

export function useWebContainer(initialFiles: PreviewFile[], enabled = true) {
  const overlayEnabled = isVitePreviewEnabled();
  const [state, setState] = useState<SandboxState>({
    status: 'idle',
    url: null,
    logs: [],
    error: null,
    engine: 'static',
    disclosure: null,
  });
  const serverRef = useRef<PreviewProcess | null>(null);
  const bootedRef = useRef(false);
  const writeQueueRef = useRef(Promise.resolve());
  const viteAttemptedRef = useRef(false);
  const engineRef = useRef<PreviewEngine>('static');
  const overlayEnabledRef = useRef(overlayEnabled);
  overlayEnabledRef.current = overlayEnabled;

  const appendLog = useCallback((line: string) => {
    setState((current) => ({ ...current, logs: [...current.logs.slice(-80), line] }));
  }, []);

  const writeFilesToContainer = useCallback(async (files: PreviewFile[]) => {
    const container = await getContainer();
    const overlayOn = overlayEnabledRef.current;
    const prepared = overlayOn ? overlayPreviewFiles(files, true) : files;
    await Promise.all(
      prepared.map(async (file) => {
        await ensureParentDirectories(container, file.path);
        await container.fs.writeFile(file.path, file.content);
      }),
    );
  }, []);

  const urlRef = useRef(state.url);
  urlRef.current = state.url;
  const doRefresh = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    const base = u.endsWith('/') ? u.slice(0, -1) : u;
    fetch(base + '/__sovereign_hmr/refresh', { method: 'POST', mode: 'cors' }).catch(() => {});
  }, []);

  const attachServer = useCallback((process: PreviewProcess, engine: PreviewEngine, fallbackError?: string) => {
    killProcess(previousBootServer);
    previousBootServer = process;
    serverRef.current = process;
    engineRef.current = engine;
    setState((current) => ({
      ...current,
      status: 'starting',
      engine,
      disclosure: engine === 'vite' ? PREVIEW_JS_DISCLOSURE : current.disclosure,
      error: fallbackError
        ? `Vite preview failed: ${fallbackError}. Using the static file server instead.`
        : current.error,
    }));
  }, []);

  const bootPreview = useCallback(
    async (mode: PreviewEngine) => {
      const container = await getContainer();
      if (mode === 'vite') {
        setState((current) => ({ ...current, status: 'installing', error: null }));
      } else {
        setState((current) => ({ ...current, status: 'starting' }));
      }
      const started = await startPreviewProcess(
        { spawn: (command, args) => container.spawn(command, args) },
        {
          mode,
          onLog: appendLog,
        },
      );
      attachServer(started.process, started.engine, started.fallbackError);
    },
    [appendLog, attachServer],
  );

  const maybeSwitchToVite = useCallback(
    async (files: PreviewFile[]) => {
      if (
        !overlayEnabledRef.current ||
        viteAttemptedRef.current ||
        engineRef.current === 'vite' ||
        !shouldBootVite(files)
      ) {
        return;
      }
      viteAttemptedRef.current = true;
      try {
        await bootPreview('vite');
      } catch (error) {
        appendLog(
          `Vite preview failed: ${error instanceof Error ? error.message : 'unknown error'}. Keeping the static file server.`,
        );
      }
    },
    [appendLog, bootPreview],
  );

  const replaceFiles = useCallback((previousFiles: PreviewFile[], nextFiles: PreviewFile[]) => {
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      const container = await getContainer();
      const nextPaths = new Set(nextFiles.map((file) => file.path));
      await Promise.all(
        previousFiles
          .filter((file) => !nextPaths.has(file.path))
          .map((file) => container.fs.rm(file.path, { force: true })),
      );
      await writeFilesToContainer(nextFiles);
      await maybeSwitchToVite(nextFiles);
    });
    return writeQueueRef.current;
  }, [maybeSwitchToVite, writeFilesToContainer]);

  const boot = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    killProcess(previousBootServer);
    previousBootServer = null;

    try {
      setState((current) => ({ ...current, status: 'booting', error: null }));
      const container = await getContainer();
      container.on('server-ready', (_port, url) => {
        setState((current) => ({ ...current, status: 'ready', url }));
      });
      diagnosticsLog = appendLog;
      diagnosticsError = (message) => {
        setState((current) => ({ ...current, status: 'error', error: message }));
      };
      if (!diagnosticsAttached) {
        diagnosticsAttached = true;
        subscribePreviewDiagnostics(container, (line) => diagnosticsLog(line), (message) => {
          diagnosticsError(message);
        });
      }

      const seedFiles = initialFiles.some((file) => isIndexHtmlPath(file.path))
        ? initialFiles
        : [...initialFiles, { path: 'index.html', content: PLACEHOLDER_INDEX_HTML }];

      await writeFilesToContainer(seedFiles);
      await writeFilesToContainer(getPreviewOverlayFiles());

      const mode: PreviewEngine = shouldBootVite(seedFiles) ? 'vite' : 'static';
      if (mode === 'vite') viteAttemptedRef.current = true;
      await bootPreview(mode);
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : 'Sandbox failed',
      }));
    }
  }, [appendLog, bootPreview, initialFiles, writeFilesToContainer]);

  const writeFilesAndMaybeVite = useCallback((files: PreviewFile[]) => {
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      await writeFilesToContainer(files);
      await maybeSwitchToVite(files);
    });
    return writeQueueRef.current;
  }, [maybeSwitchToVite, writeFilesToContainer]);

  useEffect(() => {
    return () => {
      killProcess(serverRef.current);
      serverRef.current = null;
      previousBootServer = null;
    };
  }, []);

  useEffect(() => {
    if (enabled) void boot();
  }, [boot, enabled]);

  return {
    ...state,
    writeFiles: writeFilesAndMaybeVite,
    replaceFiles,
    triggerRefresh: doRefresh,
  };
}
