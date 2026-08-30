'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebContainer, type PreviewFile } from '@/lib/use-webcontainer';
import type { FileOperationEvent, FilePreviewEvent } from '@/lib/generation-stream';

const FILE_PREVIEW_THROTTLE_MS = 120;
const PREVIEW_REFRESH_THROTTLE_MS = 500;

export type { PreviewFile };

/** PR 6 fills this in with the runtime-request waiter payload. */
export interface RuntimeRequestPayload {
  type?: string;
  [key: string]: unknown;
}

export interface UsePreviewRuntimeOptions {
  initialFiles: PreviewFile[];
  enabled?: boolean;
}

export interface UsePreviewRuntimeResult {
  status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'error';
  url: string | null;
  logs: string[];
  error: string | null;
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
  /** Today's behavior: no WC write. PR 6 applies this unthrottled. */
  applyFileOperation: (event: FileOperationEvent) => void;
  applyFiles: (files: PreviewFile[]) => Promise<void>;
  applyImmediateWrite: (files: PreviewFile[]) => Promise<void>;
  setLiveFiles: (files: PreviewFile[]) => void;
  flushPendingWrites: () => Promise<void>;
  /** PR 6: overlay HTML / WC `index.html` instrument. */
  applyOverlay: (payload?: unknown) => void;
  /** PR 6: runtime-request handler (run tool waiter). */
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

  const bumpRevision = useCallback(() => {
    setFilesRevision((n) => n + 1);
  }, []);

  const replaceMap = useCallback(
    (entries: PreviewFile[]) => {
      const next = new Map<string, string>();
      for (const file of entries) next.set(file.path, file.content);
      filesRef.current = next;
      bumpRevision();
    },
    [bumpRevision],
  );

  const filesList = useMemo(() => {
    const files =
      filesRef.current.size > 0
        ? Array.from(filesRef.current, ([path, content]) => ({ path, content }))
        : initialFiles;
    return sortPreviewFiles(files);
  }, [filesRevision, initialFiles]);

  const enqueueWrite = useCallback((files: PreviewFile[]) => {
    writeChainRef.current = writeChainRef.current.then(() => sandboxRef.current.writeFiles(files));
    return writeChainRef.current;
  }, []);

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
      void flushPendingWrites();
      return;
    }
    if (throttleTimerRef.current === null) {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        void flushPendingWrites();
      }, FILE_PREVIEW_THROTTLE_MS - elapsed);
    }
  }, [flushPendingWrites]);

  const applyFilePreview = useCallback(
    (
      event: Pick<FilePreviewEvent, 'path' | 'content'> & {
        operation?: FilePreviewEvent['operation'];
      },
    ) => {
      if (event.operation === 'delete' || event.content === undefined) return;
      filesRef.current.set(event.path, event.content);
      bumpRevision();
      pendingWritesRef.current.set(event.path, event.content);
      scheduleFlush();
    },
    [bumpRevision, scheduleFlush],
  );

  const applyFileOperation = useCallback((_event: FileOperationEvent) => {
    // PR 6: unthrottled WC write + overlay + filesRevision digest ACK.
  }, []);

  const applyOverlay = useCallback((_payload?: unknown) => {
    // PR 6: inject overlay into the WebContainer preview document.
  }, []);

  const handleRuntimeRequest = useCallback(async (_payload: RuntimeRequestPayload) => {
    // PR 6: runtime-request waiter (run tool). Empty until generate runtime lands.
  }, []);

  const applyFiles = useCallback(
    async (files: PreviewFile[]) => {
      await flushPendingWrites();
      replaceMap(files);
      await sandboxRef.current.writeFiles(files);
      lastPreviewRefreshRef.current = performance.now();
      setPreviewKey((key) => key + 1);
    },
    [flushPendingWrites, replaceMap],
  );

  const applyImmediateWrite = useCallback(
    async (files: PreviewFile[]) => {
      await flushPendingWrites();
      await sandboxRef.current.writeFiles(files);
      lastPreviewRefreshRef.current = performance.now();
      setPreviewKey((key) => key + 1);
    },
    [flushPendingWrites],
  );

  const replaceFiles = useCallback(
    async (previous: PreviewFile[], next: PreviewFile[]) => {
      await flushPendingWrites();
      replaceMap(next);
      await sandboxRef.current.replaceFiles(previous, next);
      lastPreviewRefreshRef.current = performance.now();
      setPreviewKey((key) => key + 1);
    },
    [flushPendingWrites, replaceMap],
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
    files: filesRef.current,
    filesList,
    filesRevision,
    previewKey,
    writeFiles: sandbox.writeFiles,
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
