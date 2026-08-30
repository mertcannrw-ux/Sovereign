'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@app-builder/ui/utils';
import { AlertCircle, Loader2, MousePointer2 } from 'lucide-react';
import type { PreviewCursorTarget } from '@/lib/use-smooth-cursor';
import type { SelectedPreviewElement } from '@/components/project/types';

export const VISUAL_EDITOR_SOURCE = 'sovereign-visual-editor';

export interface PreviewPaneProps {
  url: string | null;
  status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'error';
  logs: string[];
  error: string | null;
  previewKey: number;
  isEditMode: boolean;
  isSending: boolean;
  previewCursorTarget: PreviewCursorTarget | null;
  selectedPreviewElement: SelectedPreviewElement | null;
  onSelectedElementChange: (element: SelectedPreviewElement | null) => void;
  onElementSelected?: () => void;
}

export function PreviewPane({
  url,
  status,
  logs,
  error,
  previewKey,
  isEditMode,
  isSending,
  previewCursorTarget,
  selectedPreviewElement,
  onSelectedElementChange,
  onElementSelected,
}: PreviewPaneProps) {
  const [visiblePreviewSlot, setVisiblePreviewSlot] = useState<0 | 1>(0);
  const [previewSlotRevisions, setPreviewSlotRevisions] = useState<[number | null, number | null]>([
    0,
    null,
  ]);
  const visiblePreviewSlotRef = useRef<0 | 1>(0);
  const previewFramesRef = useRef<Array<HTMLIFrameElement | null>>([]);

  const setPreviewEditMode = useCallback(
    (enabled: boolean) => {
      const targetOrigin = (() => {
        try {
          return url ? new URL(url).origin : window.location.origin;
        } catch {
          return window.location.origin;
        }
      })();
      for (const frame of previewFramesRef.current) {
        frame?.contentWindow?.postMessage(
          { source: VISUAL_EDITOR_SOURCE, type: 'set-edit-mode', enabled },
          targetOrigin,
        );
      }
    },
    [url],
  );

  useEffect(() => {
    if (!url || previewKey === 0) return;
    const loadingSlot = visiblePreviewSlotRef.current === 0 ? 1 : 0;
    setPreviewSlotRevisions((current) => {
      const next: [number | null, number | null] = [...current];
      next[loadingSlot] = previewKey;
      return next;
    });
  }, [previewKey, url]);

  useEffect(() => {
    setPreviewEditMode(isEditMode);
    if (!isEditMode) onSelectedElementChange(null);
  }, [isEditMode, setPreviewEditMode, visiblePreviewSlot, onSelectedElementChange]);

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent) => {
      if (!event.data || event.data.source !== VISUAL_EDITOR_SOURCE) return;
      const fromPreview = previewFramesRef.current.some(
        (frame) => frame?.contentWindow === event.source,
      );
      if (!fromPreview) return;

      if (event.data.type === 'ready') {
        const replyOrigin =
          event.origin && event.origin !== 'null'
            ? event.origin
            : (() => {
                try {
                  return url ? new URL(url).origin : window.location.origin;
                } catch {
                  return window.location.origin;
                }
              })();
        (event.source as Window)?.postMessage(
          { source: VISUAL_EDITOR_SOURCE, type: 'set-edit-mode', enabled: isEditMode },
          { targetOrigin: replyOrigin },
        );
        return;
      }
      if (event.data.type === 'selection-cleared') {
        onSelectedElementChange(null);
        return;
      }
      if (event.data.type === 'element-selected') {
        onSelectedElementChange(event.data.element as SelectedPreviewElement);
        onElementSelected?.();
      }
    };

    window.addEventListener('message', handlePreviewMessage);
    return () => window.removeEventListener('message', handlePreviewMessage);
  }, [isEditMode, onElementSelected, onSelectedElementChange, url]);

  return (
    <div className="relative flex flex-1 overflow-hidden bg-[#0A0A0A]">
      {url ? (
        <>
          {previewSlotRevisions.map((revision, slot) =>
            revision === null ? null : (
              <iframe
                ref={(frame) => {
                  previewFramesRef.current[slot] = frame;
                }}
                key={`${slot}:${revision}`}
                src={`${url}${url.includes('?') ? '&' : '?'}revision=${revision}`}
                title={slot === visiblePreviewSlot ? 'Live app preview' : 'Loading app preview'}
                className={cn(
                  'absolute inset-0 h-full w-full border-0 bg-[#0A0A0A]',
                  slot === visiblePreviewSlot ? 'visible z-10' : 'invisible z-0',
                )}
                aria-hidden={slot !== visiblePreviewSlot}
                allow="cross-origin-isolated"
                onLoad={() => {
                  if (revision !== previewKey || slot === visiblePreviewSlotRef.current) return;
                  const nextSlot = slot as 0 | 1;
                  visiblePreviewSlotRef.current = nextSlot;
                  setVisiblePreviewSlot(nextSlot);
                  requestAnimationFrame(() => setPreviewEditMode(isEditMode));
                }}
              />
            ),
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            {status === 'error' ? (
              <AlertCircle className="mx-auto mb-3 h-7 w-7 text-error" />
            ) : (
              <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-primary" />
            )}
            <p className="text-sm font-medium text-foreground-secondary">
              {error ?? 'Starting secure preview sandbox'}
            </p>
            <p className="mt-1 text-xs text-foreground-muted">
              {logs.at(-1) ?? 'Booting browser-based Node.js runtime…'}
            </p>
          </div>
        </div>
      )}
      {isEditMode && !selectedPreviewElement && url && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-primary/40 bg-[#141414]/95 px-3 py-1.5 text-xs font-medium text-white shadow-xl backdrop-blur">
          Click an element to target it
        </div>
      )}
      {isSending && previewCursorTarget && (
        <div
          className="pointer-events-none absolute z-20 transition-[left,top] duration-300 ease-out"
          style={{ left: `${previewCursorTarget.x}%`, top: `${previewCursorTarget.y}%` }}
        >
          <MousePointer2 className="h-5 w-5 fill-primary text-primary drop-shadow-[0_2px_5px_rgba(0,0,0,0.6)]" />
          <span className="ml-4 inline-block -translate-y-1 rounded-full bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground shadow-lg">
            {previewCursorTarget.label}
          </span>
        </div>
      )}
    </div>
  );
}
