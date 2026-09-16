'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebContainer, type PreviewFile } from '@/lib/use-webcontainer';
import type { FileOperationEvent, FilePreviewEvent } from '@/lib/generation-stream';
import {
  isSovereignOverlayPath,
  isVitePreviewEnabled,
  overlayPreviewFiles,
  type PreviewEngine,
} from '@/lib/preview-startup';

const FILE_PREVIEW_THROTTLE_MS = 120;
const PREVIEW_REFRESH_THROTTLE_MS = 500;

export type { PreviewFile };

export interface RuntimeRequestPayload {
  type?: string;
  [key: string]: unknown;
}

export interface UsePreviewRuntimeOptions {
  initialFiles: PreviewFile[];
  enabled?: boolean;
  projectId?: string;
}

export interface UsePreviewRuntimeResult {
  status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'error';
  url: string | null;
  logs: string[];
  error: string | null;
  engine: PreviewEngine;
  disclosure: string | null;
  /** Re-attempts booting the sandbox after a failed boot. */
  retry: () => void;
  /** Mutable path → content store. Re-read when `filesRevision` changes. */
  files: Map<string, string>;
  filesList: PreviewFile[];
  filesRevision: number;
  previewKey: number;
  writeFiles: (files: PreviewFile[]) => Promise<void>;
  replaceFiles: (previous: PreviewFile[], next: PreviewFile[]) => Promise<void>;
  triggerRefresh: () => void;
  refreshPreview: () => void;
  /** Throttled 120 ms + trailing flush. Used for `file-preview` / `file-progress`. */
  applyFilePreview: (
    event: Pick<FilePreviewEvent, 'path' | 'content'> & {
      operation?: FilePreviewEvent['operation'];
    },
  ) => void;
  /** No-op until runtime apply/overlay exists. */
  applyFileOperation: (event: FileOperationEvent) => void;
  applyFiles: (files: PreviewFile[]) => Promise<void>;
  applyImmediateWrite: (files: PreviewFile[]) => Promise<void>;
  setLiveFiles: (files: PreviewFile[]) => void;
  flushPendingWrites: () => Promise<void>;
  /** Runtime-request overlay (PR 6). HTML/script overlay is applied via overlayPreviewFiles. */
  applyOverlay: (payload?: unknown) => void;
  /** No-op until runtime-request waiter exists. */
  handleRuntimeRequest: (payload: RuntimeRequestPayload) => Promise<void>;
}

function sortPreviewFiles(files: PreviewFile[]): PreviewFile[] {
  return [...files].sort((a, b) => {
    const aScore = a.path === 'index.html' ? 0 : a.path.endsWith('.html') ? 1 : 2;
    const bScore = b.path === 'index.html' ? 0 : b.path.endsWith('.html') ? 1 : 2;
    if (aScore !== bScore) return aScore - bScore;
    return a.path.localeCompare(b.path);
  });
}

export function usePreviewRuntime({
  initialFiles,
  enabled = true,
  projectId,
}: UsePreviewRuntimeOptions): UsePreviewRuntimeResult {
  const sandbox = useWebContainer(initialFiles, enabled);
  const filesRef = useRef(new Map<string, string>());
  const [filesRevision, setFilesRevision] = useState(0);
  const [previewKey, setPreviewKey] = useState(0);

  const lastSandboxWriteRef = useRef(0);
  const lastPreviewRefreshRef = useRef(0);
  const pendingWritesRef = useRef(new Map<string, string>());
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChainRef = useRef(Promise.resolve());
  const sandboxRef = useRef(sandbox);
  sandboxRef.current = sandbox;
  const projectIdRef = useRef(projectId);

  const bumpRevision = useCallback(() => {
    setFilesRevision((n) => n + 1);
  }, []);

  const previousProjectId = projectIdRef.current;
  if (projectId !== undefined && previousProjectId !== projectId) {
    projectIdRef.current = projectId;
    filesRef.current.clear();
    pendingWritesRef.current = new Map();
  }
  if (filesRef.current.size === 0 && initialFiles.length > 0) {
    for (const file of initialFiles) {
      if (isSovereignOverlayPath(file.path)) continue;
      filesRef.current.set(file.path, file.content);
    }
  }

  const replaceMap = useCallback(
    (entries: PreviewFile[]) => {
      filesRef.current.clear();
      for (const file of entries) {
        if (isSovereignOverlayPath(file.path)) continue;
        filesRef.current.set(file.path, file.content);
      }
      bumpRevision();
    },
    [bumpRevision],
  );

  const filesList = useMemo(
    () => sortPreviewFiles(Array.from(filesRef.current, ([path, content]) => ({ path, content }))),
    [filesRevision, initialFiles],
  );

  const enqueueOp = useCallback((op: () => Promise<void>) => {
    const next = writeChainRef.current.then(op, op);
    writeChainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  const toWcFiles = useCallback((files: PreviewFile[]) => {
    const projectFiles = files.filter((file) => !isSovereignOverlayPath(file.path));
    return overlayPreviewFiles(projectFiles, isVitePreviewEnabled());
  }, []);

  const enqueueWrite = useCallback(
    (files: PreviewFile[]) => enqueueOp(() => sandboxRef.current.writeFiles(toWcFiles(files))),
    [enqueueOp, toWcFiles],
  );

  const enqueueReplace = useCallback(
    (previous: PreviewFile[], next: PreviewFile[]) =>
      enqueueOp(() =>
        sandboxRef.current.replaceFiles(
          previous.filter((file) => !isSovereignOverlayPath(file.path)),
          toWcFiles(next),
        ),
      ),
    [enqueueOp, toWcFiles],
  );

  const flushPendingWrites = useCallback(async () => {
    if (throttleTimerRef.current !== null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    const pending = pendingWritesRef.current;
    if (pending.size === 0) return;
    pendingWritesRef.current = new Map();
    const files = Array.from(pending, ([path, content]) => ({ path, content }));
    lastSandboxWriteRef.current = performance.now();
    await enqueueWrite(files);
    const now = performance.now();
    if (now - lastPreviewRefreshRef.current >= PREVIEW_REFRESH_THROTTLE_MS) {
      lastPreviewRefreshRef.current = now;
      setPreviewKey((key) => key + 1);
    }
  }, [enqueueWrite]);

  const scheduleFlush = useCallback(() => {
    const now = performance.now();
    const elapsed = now - lastSandboxWriteRef.current;
    if (elapsed >= FILE_PREVIEW_THROTTLE_MS) {
      void flushPendingWrites().catch(() => undefined);
      return;
    }
    if (throttleTimerRef.current === null) {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        void flushPendingWrites().catch(() => undefined);
      }, FILE_PREVIEW_THROTTLE_MS - elapsed);
    }
  }, [flushPendingWrites]);

  const removeFiles = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      let changed = false;
      for (const path of paths) {
        if (filesRef.current.delete(path)) changed = true;
        pendingWritesRef.current.delete(path);
      }
      if (changed) bumpRevision();
      // Deletes join the same serialized write chain as preview writes so an
      // in-flight write for the same path cannot resurrect the file.
      void enqueueOp(() => sandboxRef.current.removeFiles(paths));
    },
    [bumpRevision, enqueueOp],
  );

  const applyFilePreview = useCallback(
    (
      event: Pick<FilePreviewEvent, 'path' | 'content'> & {
        operation?: FilePreviewEvent['operation'];
      },
    ) => {
      if (event.operation === 'delete') {
        // Rollback of a never-committed (or since-committed-over) file:
        // remove it from the local mirror and the container.
        removeFiles([event.path]);
        return;
      }
      if (event.content === undefined) return;
      if (isSovereignOverlayPath(event.path)) return;
      filesRef.current.set(event.path, event.content);
      bumpRevision();
      pendingWritesRef.current.set(event.path, event.content);
      scheduleFlush();
    },
    [bumpRevision, removeFiles, scheduleFlush],
  );

  const applyFileOperation = useCallback(
    (event: FileOperationEvent) => {
      if (event.operation === 'delete') {
        removeFiles([event.path]);
        return;
      }
      if (event.content !== undefined) {
        // Committed create/update: same mirror + throttled-write path as
        // streamed previews. Duplicate writes are idempotent.
        applyFilePreview({ operation: event.operation, path: event.path, content: event.content });
      }
    },
    [applyFilePreview, removeFiles],
  );

  const applyOverlay = useCallback((_payload?: unknown) => {
    // HTML overlay is applied in overlayPreviewFiles / WC writes. This is the PR 6 runtime overlay.
  }, []);

  const handleRuntimeRequest = useCallback(async (_payload: RuntimeRequestPayload) => {
    // No-op until runtime-request waiter exists.
  }, []);

  const applyFiles = useCallback(
    async (files: PreviewFile[]) => {
      await flushPendingWrites();
      const previous = new Set(filesRef.current.keys());
      replaceMap(files);
      // Full-sync event: files absent from the authoritative set (agent
      // deletions, rollbacks) must be removed from the container too, or the
      // preview keeps serving files the project no longer contains.
      const next = new Set(files.map((file) => file.path));
      const removed = [...previous].filter((path) => !next.has(path));
      await enqueueOp(async () => {
        if (removed.length > 0) {
          await sandboxRef.current.removeFiles(removed);
        }
        await sandboxRef.current.writeFiles(toWcFiles(files));
      });
      lastPreviewRefreshRef.current = performance.now();
      setPreviewKey((key) => key + 1);
    },
    [enqueueOp, flushPendingWrites, replaceMap, toWcFiles],
  );

  const applyImmediateWrite = useCallback(
    async (files: PreviewFile[]) => {
      await flushPendingWrites();
      await enqueueWrite(files);
      lastPreviewRefreshRef.current = performance.now();
      setPreviewKey((key) => key + 1);
    },
    [enqueueWrite, flushPendingWrites],
  );

  const replaceFiles = useCallback(
    async (previous: PreviewFile[], next: PreviewFile[]) => {
      await flushPendingWrites();
      replaceMap(next);
      await enqueueReplace(previous, next);
      lastPreviewRefreshRef.current = performance.now();
      setPreviewKey((key) => key + 1);
    },
    [enqueueReplace, flushPendingWrites, replaceMap],
  );

  const setLiveFiles = useCallback(
    (files: PreviewFile[]) => {
      replaceMap(files);
    },
    [replaceMap],
  );

  const refreshPreview = useCallback(() => {
    setPreviewKey((key) => key + 1);
  }, []);

  const didMountProjectRef = useRef(false);
  useEffect(() => {
    if (!didMountProjectRef.current) {
      didMountProjectRef.current = true;
      return;
    }
    if (throttleTimerRef.current !== null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    lastSandboxWriteRef.current = 0;
    lastPreviewRefreshRef.current = 0;
    setPreviewKey(0);
  }, [projectId]);

  const seededProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || initialFiles.length === 0 || !projectId) return;
    if (seededProjectRef.current === projectId) return;
    seededProjectRef.current = projectId;
    void applyFiles(initialFiles);
  }, [applyFiles, enabled, initialFiles, projectId]);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, []);

  return {
    status: sandbox.status,
    url: sandbox.url,
    logs: sandbox.logs,
    error: sandbox.error,
    engine: sandbox.engine,
    disclosure: sandbox.disclosure,
    retry: sandbox.retry,
    files: filesRef.current,
    filesList,
    filesRevision,
    previewKey,
    writeFiles: enqueueWrite,
    replaceFiles,
    triggerRefresh: sandbox.triggerRefresh,
    refreshPreview,
    applyFilePreview,
    applyFileOperation,
    applyFiles,
    applyImmediateWrite,
    setLiveFiles,
    flushPendingWrites,
    applyOverlay,
    handleRuntimeRequest,
  };
}
