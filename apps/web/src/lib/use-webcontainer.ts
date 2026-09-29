'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import {
  getPreviewOverlayFiles,
  isIndexHtmlPath,
  isSovereignOverlayPath,
  isVitePreviewEnabled,
  overlayPreviewFiles,
  PREVIEW_JS_DISCLOSURE,
  PreviewBootCancelledError,
  scheduleViteReadyFallback,
  shouldBootVite,
  startPreviewProcess,
  subscribePreviewDiagnostics,
  type PreviewEngine,
  type PreviewProcess,
  type StartPreviewProcessResult,
} from '@/lib/preview-startup';
import {
  MAX_PREVIEW_ERRORS,
  MAX_PREVIEW_ERROR_CHARS,
  RUNTIME_OUTPUT_MAX_CHARS,
  truncateRuntimeOutput,
  type RuntimeCommandExecution,
} from '@/lib/runtime-commands';

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

/** The server promoted by the most recent `server-ready`; module-level so a new
 * hook instance can adopt (or kill) a preview started before it mounted. */
let previousBootServer: PreviewProcess | null = null;
/** Global diagnostics sink. The hook repoints these at its live `setState` on
 * every boot, so one container-level subscription survives remounts without
 * ever writing into a dead instance's state. */
let diagnosticsLog: (line: string) => void = () => {};
let diagnosticsError: (message: string) => void = () => {};
/** Preview console errors (iframe console.error / uncaught / rejections) for the
 * agent loop. Repointed like the sinks above; the owning hook keeps the ring. */
let previewErrorSink: (line: string) => void = () => {};
/** Teardown for the diagnostics subscription belonging to `containerPromise`. */
let diagnosticsUnsubscribe: (() => void) | null = null;

async function getContainer(): Promise<WebContainer> {
  if (!containerPromise) {
    containerPromise = import('@webcontainer/api').then(({ WebContainer }) =>
      WebContainer.boot({
        coep: 'require-corp',
        // `true` (not 'exceptions-only') so `console.error` is forwarded too:
        // React and Vite report most real failures through console.error, and
        // those are exactly the lines the agent needs to see.
        forwardPreviewErrors: true,
      }),
    );
  }
  return containerPromise;
}

/**
 * Drop the cached container so the next `getContainer()` boots a fresh sandbox.
 * A rejected `WebContainer.boot` never recovers, so this is the only way back
 * from a failed boot. Any diagnostics listener bound to the discarded container
 * is detached here; subscriptions are re-established by the next boot.
 *
 * The discarded instance must also be torn down: `WebContainer.boot` allows a
 * single live instance, so merely dropping the cached promise made every later
 * `boot()` reject with "Only a single WebContainer instance can be booted" and
 * the preview's Retry button could never recover. `boot()` itself waits for a
 * pending teardown, so a retry that races this is still ordered correctly.
 */
function resetContainer(): void {
  diagnosticsUnsubscribe?.();
  diagnosticsUnsubscribe = null;
  const discarded = containerPromise;
  containerPromise = null;
  if (!discarded) return;
  void discarded
    .then((container) => container.teardown())
    .catch(() => {
      // Never booted (or already torn down) — nothing to release.
    });
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

/**
 * Directories that belong to the toolchain, never to a project's source tree.
 * `node_modules` alone would make a full walk expensive; the rest are build
 * artefacts and caches a project does not own.
 */
const VENDOR_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.vite',
  '.cache',
  '.npm',
]);

/** Container-owned files that are not part of any project's file set. */
const CONTAINER_OWNED_FILES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'npm-debug.log',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

/**
 * Every project-owned file currently in the container, as relative paths.
 *
 * The WebContainer is a single module-level instance shared by every project a
 * browser session opens, and it keeps files a project has since deleted. A
 * command like `tsc --noEmit` compiles everything under `tsconfig.include`, so
 * leftovers from another project show up as errors in files the project does
 * not have — the walk exists to find and delete them.
 */
async function listProjectTree(container: WebContainer, directory = '.'): Promise<string[]> {
  const entries = await container.fs.readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = directory === '.' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (VENDOR_DIRECTORIES.has(entry.name)) continue;
      paths.push(...(await listProjectTree(container, path)));
    } else {
      paths.push(path);
    }
  }
  return paths;
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
  const initialFilesRef = useRef(initialFiles);
  initialFilesRef.current = initialFiles;
  const rejectStaticFallbackRef = useRef(false);
  /** False once this hook instance is gone; gates every container write and the
   * in-flight boot flow, because the container (and its filesystem) is shared
   * with whatever preview mounts next. */
  const aliveRef = useRef(true);
  /** True while this instance is waiting for a server *it* started to report
   * `server-ready`; without it the container-level event would let this project
   * adopt a port that belongs to the previous project's preview. */
  const awaitingServerReadyRef = useRef(false);
  /** True while this instance owns the module-level `server-ready` listener. */
  const serverReadyAttachedRef = useRef(false);
  /** Detaches this instance's `server-ready` listener on unmount. */
  const serverReadyUnsubscribeRef = useRef<(() => void) | null>(null);

  const enqueue = useCallback((op: () => Promise<void>) => {
    const next = writeQueueRef.current.then(
      // The container filesystem is shared by every project this browser session
      // opens. An op queued by a preview that has since unmounted would write
      // the old project's files *after* the next project's boot — the new
      // project's preview would then serve the previous project's app.
      () => (aliveRef.current ? op() : undefined),
      () => (aliveRef.current ? op() : undefined),
    );
    writeQueueRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  const appendLog = useCallback((line: string) => {
    setState((current) => ({ ...current, logs: [...current.logs.slice(-80), line] }));
  }, []);

  /**
   * Bounded ring of preview console errors, newest last. Read at send time to
   * give the agent loop the failures the browser already saw (and attached to
   * every `run` result). A ref, not state: readers pull it, it never renders.
   */
  const previewErrorsRef = useRef<string[]>([]);
  const getPreviewErrors = useCallback(() => [...previewErrorsRef.current], []);

  /**
   * Run one allowlisted command in the shared container and collect its output.
   * Resolves — never rejects — with the failure described, because the caller
   * owes the blocked server a result for every `runtime-request` it accepts.
   * WebContainer exposes stdout and stderr as one terminal stream, so there is
   * a single `output` field; the exit code disambiguates success.
   */
  const runCommand = useCallback(
    async (argv: readonly string[], timeoutMs: number): Promise<RuntimeCommandExecution> => {
      const command = argv.join(' ');
      const startedAt = performance.now();
      let process: WebContainerProcess;
      try {
        const container = await getContainer();
        process = await container.spawn(argv[0]!, argv.slice(1));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start the command';
        appendLog(`$ ${command}\n${message}`);
        return {
          output: '',
          exitCode: null,
          durationMs: Math.round(performance.now() - startedAt),
          error: message,
        };
      }

      appendLog(`$ ${command}`);
      // Keep draining after the cap so the stream cannot back-pressure a killed
      // process; the shared truncator then keeps the head and the tail.
      const collectLimit = RUNTIME_OUTPUT_MAX_CHARS * 4;
      let output = '';
      const reader = process.output.getReader();
      const drain = (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (output.length < collectLimit) output += value;
          }
        } catch {
          // Killed processes abort their output stream.
        }
      })();

      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            process.kill();
          } catch {
            // Already exited.
          }
          resolve(null);
        }, timeoutMs);
      });
      let exitCode: number | null;
      try {
        exitCode = await Promise.race([process.exit, timeout]);
      } finally {
        clearTimeout(timer);
      }
      // The process is gone (or the kill was issued); give the reader a moment
      // to surface the last buffered chunks, then report.
      await Promise.race([
        drain,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1000);
        }),
      ]);

      const durationMs = Math.round(performance.now() - startedAt);
      appendLog(
        timedOut
          ? `Command timed out after ${(durationMs / 1000).toFixed(1)}s`
          : `Command exited with code ${exitCode} in ${(durationMs / 1000).toFixed(1)}s`,
      );
      return timedOut
        ? {
            output: truncateRuntimeOutput(output),
            exitCode: null,
            durationMs,
            error: `timed out after ${Math.round(timeoutMs / 1000)}s and was killed`,
          }
        : { output: truncateRuntimeOutput(output), exitCode, durationMs };
    },
    [appendLog],
  );

  const writeFilesToContainer = useCallback(async (files: PreviewFile[]) => {
    if (!aliveRef.current) return;
    const container = await getContainer();
    // The awaits above (and inside the loop) can outlive this instance; a write
    // that lands after unmount would overwrite the next project's file with
    // this one's content.
    if (!aliveRef.current) return;
    const overlayOn = overlayEnabledRef.current;
    const prepared = overlayOn ? overlayPreviewFiles(files, true) : files;
    await Promise.all(
      prepared.map(async (file) => {
        await ensureParentDirectories(container, file.path);
        await container.fs.writeFile(file.path, file.content);
      }),
    );
  }, []);

  /**
   * Reconcile + write, without queueing. Safe to call from inside an op that
   * already owns the write chain (`boot`), where re-entering it would deadlock.
   */
  const syncProjectTreeInner = useCallback(
    async (files: PreviewFile[]) => {
      const container = await getContainer();
      if (!aliveRef.current) return;
      const expected = new Set(files.map((file) => file.path));
      const existing = await listProjectTree(container);
      const stale = existing.filter(
        (path) =>
          !expected.has(path) && !CONTAINER_OWNED_FILES.has(path) && !isSovereignOverlayPath(path),
      );
      if (stale.length > 0) {
        await Promise.all(stale.map((path) => container.fs.rm(path, { force: true })));
        appendLog(
          `Removed ${stale.length} file${stale.length === 1 ? '' : 's'} this project no longer has: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', …' : ''}`,
        );
      }
      await writeFilesToContainer(files);
    },
    [appendLog, writeFilesToContainer],
  );

  /**
   * Make the container's tree equal `files` (the project's authoritative set):
   * delete every project-owned path the set does not contain, then write the
   * set. A `run` must not spawn until this has settled, or the command compiles
   * another project's leftovers — `tsc` walks everything under `src`, and the
   * container is shared by every project this browser session opens.
   */
  const syncProjectTree = useCallback(
    (files: PreviewFile[]) => enqueue(() => syncProjectTreeInner(files)),
    [enqueue, syncProjectTreeInner],
  );

  const urlRef = useRef(state.url);
  urlRef.current = state.url;
  const doRefresh = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    const base = u.endsWith('/') ? u.slice(0, -1) : u;
    fetch(base + '/__sovereign_hmr/refresh', { method: 'POST', mode: 'cors' }).catch(() => {});
  }, []);

  const restoreLiveStatic = useCallback(
    (
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
    },
    [],
  );

  const attachServer = useCallback(
    (
      process: PreviewProcess,
      engine: PreviewEngine,
      fallbackError?: string,
      reusedExisting?: boolean,
    ) => {
      // Ownership of the `server-ready` window ends here: from now on the
      // process is in `pendingProcessRef` and any further event is checked
      // against it.
      awaitingServerReadyRef.current = false;
      const fallbackMessage = fallbackError
        ? `Vite preview failed: ${fallbackError}. Using the static file server instead.`
        : undefined;
      rejectStaticFallbackRef.current = Boolean(
        fallbackError && shouldBootVite(initialFilesRef.current),
      );
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
        status: rejectStaticFallbackRef.current ? 'error' : 'starting',
        engine,
        disclosure: engine === 'vite' ? PREVIEW_JS_DISCLOSURE : current.disclosure,
        error: rejectStaticFallbackRef.current
          ? `Vite preview failed: ${fallbackError}. The static file server cannot run TypeScript React apps.`
          : (fallbackMessage ?? current.error),
        url: rejectStaticFallbackRef.current ? null : current.url,
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
    },
    [appendLog, enqueue, restoreLiveStatic],
  );

  const bootPreview = useCallback(
    async (mode: PreviewEngine) => {
      const container = await getContainer();
      if (!aliveRef.current) return;
      if (mode === 'vite') {
        setState((current) => ({ ...current, status: 'installing', error: null }));
      } else {
        setState((current) => ({ ...current, status: 'starting' }));
      }
      const liveStatic =
        previousBootServer ??
        (engineRef.current === 'static' ? (pendingProcessRef.current ?? serverRef.current) : null);
      awaitingServerReadyRef.current = true;
      let started: StartPreviewProcessResult;
      try {
        started = await startPreviewProcess(
          { spawn: (command, args) => container.spawn(command, args) },
          {
            mode,
            onLog: appendLog,
            existingStatic: liveStatic,
            isCancelled: () => !aliveRef.current,
          },
        );
      } catch (error) {
        awaitingServerReadyRef.current = false;
        throw error;
      }
      if (!aliveRef.current) {
        // Cancelled while the process started: nobody will ever adopt or kill
        // it, so this instance has to.
        awaitingServerReadyRef.current = false;
        killProcess(started.process);
        throw new PreviewBootCancelledError();
      }
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

  const replaceFiles = useCallback(
    (previousFiles: PreviewFile[], nextFiles: PreviewFile[]) => {
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
    },
    [enqueue, maybeSwitchToVite, writeFilesToContainer],
  );

  const removeFiles = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return Promise.resolve();
      return enqueue(async () => {
        const container = await getContainer();
        await Promise.all(paths.map((path) => container.fs.rm(path, { force: true })));
      });
    },
    [enqueue],
  );

  /**
   * Attach this instance's `server-ready` listener to the shared container.
   *
   * The container is a module-level singleton but the listener closes over this
   * instance's refs and `setState`, so ownership must move with the instance:
   * the previous owner detaches on unmount (see the cleanup effect) and the
   * next mount re-attaches. A module-level "attached once" latch would leave
   * the listener bound to a dead instance's nulled refs, and the preview would
   * never become ready again for the rest of the browser session.
   */
  const attachServerReadyListener = useCallback(
    (container: WebContainer) => {
      if (serverReadyAttachedRef.current) return;
      serverReadyAttachedRef.current = true;
      const unsubscribe = container.on('server-ready', (_port, url) => {
        const pending = pendingProcessRef.current;
        if (!pending && !awaitingServerReadyRef.current) {
          // A server this preview did not start — typically the previous project's
          // Vite process, whose boot outlived the page that spawned it. Adopting
          // its port would point this project's pane at another project's preview,
          // and at a dead URL once that process goes away.
          appendLog(`Ignored preview server on port ${_port}: not started by this preview.`);
          return;
        }
        awaitingServerReadyRef.current = false;
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
        setState((current) => {
          if (rejectStaticFallbackRef.current && engineRef.current === 'static') {
            return {
              ...current,
              status: 'error',
              url: null,
              error:
                current.error ??
                'Vite preview failed. The static file server cannot run TypeScript React apps.',
            };
          }
          return {
            ...current,
            status: 'ready',
            url,
            engine: engineRef.current,
            disclosure: engineRef.current === 'vite' ? PREVIEW_JS_DISCLOSURE : current.disclosure,
          };
        });
      });
      // Unsubscribing also clears the latch so a retry can re-attach.
      serverReadyUnsubscribeRef.current = () => {
        serverReadyAttachedRef.current = false;
        if (typeof unsubscribe === 'function') unsubscribe();
      };
      // `appendLog` is a stable useCallback, so the listener (and the `boot` that
      // owns it) keeps its identity across renders.
    },
    [appendLog],
  );

  const boot = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    await enqueue(async () => {
      try {
        setState((current) => ({ ...current, status: 'booting', error: null }));
        const container = await getContainer();
        attachServerReadyListener(container);
        // Keep the global diagnostics sink pointed at the live instance.
        diagnosticsLog = appendLog;
        diagnosticsError = (message) => {
          setState((current) => ({ ...current, status: 'error', error: message }));
        };
        previewErrorSink = (line) => {
          const errors = previewErrorsRef.current;
          // React can log the same failure on every render; keep the ring useful.
          if (errors[errors.length - 1] === line) return;
          errors.push(line.slice(0, MAX_PREVIEW_ERROR_CHARS));
          if (errors.length > MAX_PREVIEW_ERRORS) {
            errors.splice(0, errors.length - MAX_PREVIEW_ERRORS);
          }
        };
        // The container is a singleton, so diagnostics are subscribed once and
        // route through the sinks above rather than capturing this instance.
        if (!diagnosticsUnsubscribe) {
          diagnosticsUnsubscribe = subscribePreviewDiagnostics(
            container,
            (line) => diagnosticsLog(line),
            (message) => {
              diagnosticsError(message);
            },
            (line) => previewErrorSink(line),
          );
        }

        const seedFiles = initialFiles.some((file) => isIndexHtmlPath(file.path))
          ? initialFiles
          : [...initialFiles, { path: 'index.html', content: PLACEHOLDER_INDEX_HTML }];

        // Reconcile rather than merely write: this container instance may still
        // hold the previous project's tree from earlier in this browser session.
        await syncProjectTreeInner(seedFiles);
        await writeFilesToContainer(getPreviewOverlayFiles());
        // Navigating away during those writes is common; booting now would
        // start a server for a page that no longer exists.
        if (!aliveRef.current) return;

        const mode: PreviewEngine = shouldBootVite(seedFiles) ? 'vite' : 'static';
        if (mode === 'vite') viteAttemptedRef.current = true;
        await bootPreview(mode);
      } catch (error) {
        // A boot whose owner went away is not a failure: the shared container
        // and any other project's preview must be left exactly as they are.
        if (error instanceof PreviewBootCancelledError) return;
        // A failed boot must not brick the session: drop the cached container
        // (a rejected WebContainer.boot never recovers) and the bootedRef
        // latch so a later retry can start over. Kill any half-started preview
        // process so it cannot keep running orphaned.
        awaitingServerReadyRef.current = false;
        resetContainer();
        bootedRef.current = false;
        cancelViteWatchRef.current?.();
        cancelViteWatchRef.current = null;
        killProcess(pendingProcessRef.current);
        pendingProcessRef.current = null;
        setState((current) => ({
          ...current,
          status: 'error',
          error: error instanceof Error ? error.message : 'Sandbox failed',
        }));
      }
    });
  }, [
    appendLog,
    attachServerReadyListener,
    bootPreview,
    enqueue,
    initialFiles,
    writeFilesToContainer,
  ]);

  const writeFilesAndMaybeVite = useCallback(
    (files: PreviewFile[]) => {
      return enqueue(async () => {
        await writeFilesToContainer(files);
        await maybeSwitchToVite(files);
      });
    },
    [enqueue, maybeSwitchToVite, writeFilesToContainer],
  );

  /**
   * Recover from a failed preview. Clearing the latches is what makes this
   * work: `bootedRef` short-circuits `boot()` and `viteAttemptedRef` blocks a
   * second Vite attempt, so without the reset the Retry button was a no-op
   * after any post-boot failure.
   */
  const retry = useCallback(() => {
    bootedRef.current = false;
    viteAttemptedRef.current = false;
    rejectStaticFallbackRef.current = false;
    // A retry starts a new boot attempt, so the previous attempt's ownership of
    // the `server-ready` window is void.
    awaitingServerReadyRef.current = false;
    // Drop the cached container: a rejected WebContainer.boot never recovers,
    // and the next getContainer() starts a fresh sandbox.
    resetContainer();
    cancelViteWatchRef.current?.();
    cancelViteWatchRef.current = null;
    killProcess(pendingProcessRef.current);
    pendingProcessRef.current = null;
    killProcess(serverRef.current);
    serverRef.current = null;
    killProcess(previousBootServer);
    previousBootServer = null;
    setState((current) => ({ ...current, status: 'booting', error: null, url: null }));
    void boot();
  }, [boot]);

  useEffect(() => {
    // Lifecycle gate for the shared container. React StrictMode runs this
    // cleanup immediately after the first setup and then re-runs the setup
    // synchronously, so the flag is restored before any boot continuation
    // resumes (promise callbacks cannot interleave a synchronous
    // cleanup+setup pair) and the dev double-invoke stays harmless. A real
    // unmount leaves it false for good.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      awaitingServerReadyRef.current = false;
    };
  }, []);

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
      // Hand `server-ready` back so the next mount can own it. Without this the
      // listener would stay bound to this instance's nulled refs, and a
      // remounted preview would never become ready again.
      serverReadyUnsubscribeRef.current?.();
      serverReadyUnsubscribeRef.current = null;
      // Stop routing container diagnostics into this instance's dead state.
      diagnosticsLog = () => {};
      diagnosticsError = () => {};
      previewErrorSink = () => {};
    };
  }, []);

  useEffect(() => {
    if (enabled) void boot();
  }, [boot, enabled]);

  return {
    ...state,
    writeFiles: writeFilesAndMaybeVite,
    replaceFiles,
    removeFiles,
    retry,
    triggerRefresh: doRefresh,
    runCommand,
    syncProjectTree,
    getPreviewErrors,
    appendLog,
  };
}
