'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import {
  getPreviewOverlayFiles,
  isIndexHtmlPath,
  isVitePreviewEnabled,
  overlayPreviewFiles,
  PREVIEW_JS_DISCLOSURE,
  scheduleViteReadyFallback,
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
  const pendingProcessRef = useRef<PreviewProcess | null>(null);
  const cancelViteWatchRef = useRef<(() => void) | null>(null);
  const bootedRef = useRef(false);
  const writeQueueRef = useRef(Promise.resolve());
  const viteAttemptedRef = useRef(false);
  const engineRef = useRef<PreviewEngine>('static');
  const overlayEnabledRef = useRef(overlayEnabled);
  overlayEnabledRef.current = overlayEnabled;

  const enqueue = useCallback((op: () => Promise<void>) => {
    const next = writeQueueRef.current.then(op, op);
    writeQueueRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

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

  const restoreLiveStatic = useCallback((
    failedProcess: PreviewProcess | null,
    error: string,
    liveCandidate?: PreviewProcess | null,
  ) => {
    const live =
      (liveCandidate && liveCandidate !== failedProcess ? liveCandidate : null) ??
      (previousBootServer && previousBootServer !== failedProcess ? previousBootServer : null);
    if (!live) return false;
    if (failedProcess && failedProcess !== live) killProcess(failedProcess);
    cancelViteWatchRef.current?.();
    cancelViteWatchRef.current = null;
    pendingProcessRef.current = null;
    serverRef.current = live;
    engineRef.current = 'static';
    setState((current) => ({
      ...current,
      status: 'ready',
      engine: 'static',
      error,
    }));
    return true;
  }, []);

  const attachServer = useCallback((
    process: PreviewProcess,
    engine: PreviewEngine,
    fallbackError?: string,
    reusedExisting?: boolean,
  ) => {
    const fallbackMessage = fallbackError
      ? `Vite preview failed: ${fallbackError}. Using the static file server instead.`
      : undefined;
    if (
      reusedExisting &&
      restoreLiveStatic(
        pendingProcessRef.current === process ? null : pendingProcessRef.current,
        fallbackMessage ?? 'Vite preview failed. Keeping the static file server.',
        process,
      )
    ) {
      return;
    }
    cancelViteWatchRef.current?.();
    cancelViteWatchRef.current = null;
    pendingProcessRef.current = process;
    serverRef.current = process;
    engineRef.current = engine;
    setState((current) => ({
      ...current,
      status: 'starting',
      engine,
      disclosure: engine === 'vite' ? PREVIEW_JS_DISCLOSURE : current.disclosure,
      error: fallbackMessage ?? current.error,
    }));
    if (engine === 'vite') {
      cancelViteWatchRef.current = scheduleViteReadyFallback(process, {
        isCurrent: () => pendingProcessRef.current === process,
        onLog: appendLog,
        onFallback: () => {
          void enqueue(async () => {
            if (
              restoreLiveStatic(
                process,
                'Vite preview failed before it was ready. Keeping the static file server.',
              )
            ) {
              return;
            }
            const container = await getContainer();
            const started = await startPreviewProcess(
              { spawn: (command, args) => container.spawn(command, args) },
              { mode: 'static', onLog: appendLog },
            );
            pendingProcessRef.current = started.process;
            serverRef.current = started.process;
            engineRef.current = 'static';
            setState((current) => ({
              ...current,
              status: 'starting',
              engine: 'static',
              error: `Vite preview failed: process died before ready. Using the static file server instead.`,
            }));
          });
        },
      });
    }
  }, [appendLog, enqueue, restoreLiveStatic]);

  const bootPreview = useCallback(
    async (mode: PreviewEngine) => {
      const container = await getContainer();
      if (mode === 'vite') {
        setState((current) => ({ ...current, status: 'installing', error: null }));
      } else {
        setState((current) => ({ ...current, status: 'starting' }));
      }
      const liveStatic =
        previousBootServer ??
        (engineRef.current === 'static' ? (pendingProcessRef.current ?? serverRef.current) : null);
      const started = await startPreviewProcess(
        { spawn: (command, args) => container.spawn(command, args) },
        {
          mode,
          onLog: appendLog,
          existingStatic: liveStatic,
        },
      );
      attachServer(started.process, started.engine, started.fallbackError, started.reusedExisting);
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
    return enqueue(async () => {
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
  }, [enqueue, maybeSwitchToVite, writeFilesToContainer]);

  const boot = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    await enqueue(async () => {
      try {
        setState((current) => ({ ...current, status: 'booting', error: null }));
        const container = await getContainer();
        container.on('server-ready', (_port, url) => {
          const pending = pendingProcessRef.current;
          if (pending && previousBootServer && previousBootServer !== pending) {
            killProcess(previousBootServer);
          }
          if (pending) {
            previousBootServer = pending;
            serverRef.current = pending;
            pendingProcessRef.current = null;
          }
          cancelViteWatchRef.current?.();
          cancelViteWatchRef.current = null;
          setState((current) => ({
            ...current,
            status: 'ready',
            url,
            engine: engineRef.current,
            disclosure: engineRef.current === 'vite' ? PREVIEW_JS_DISCLOSURE : current.disclosure,
          }));
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
    });
  }, [appendLog, bootPreview, enqueue, initialFiles, writeFilesToContainer]);

  const writeFilesAndMaybeVite = useCallback((files: PreviewFile[]) => {
    return enqueue(async () => {
      await writeFilesToContainer(files);
      await maybeSwitchToVite(files);
    });
  }, [enqueue, maybeSwitchToVite, writeFilesToContainer]);

  useEffect(() => {
    return () => {
      cancelViteWatchRef.current?.();
      cancelViteWatchRef.current = null;
      killProcess(pendingProcessRef.current);
      pendingProcessRef.current = null;
      killProcess(serverRef.current);
      serverRef.current = null;
      killProcess(previousBootServer);
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
