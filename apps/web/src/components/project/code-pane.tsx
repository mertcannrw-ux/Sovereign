'use client';

import { cn } from '@app-builder/ui/utils';
import { FileCode2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { PreviewFile } from '@/lib/use-webcontainer';
import type { ActiveFileState } from '@/lib/generation-stream';

const MAX_CODE_PREVIEW_CHARS = 50000;

/** Vertical geometry of the streaming cursor inside the code <pre>: p-4 (16px) padding + 20px per line (text-xs leading-5). */
function cursorOffsetTop(line: number): number {
  return 16 + Math.max(0, line - 1) * 20;
}

export interface CodePaneProps {
  files: PreviewFile[];
  activeFile: ActiveFileState | null;
  isSending: boolean;
  onSelectFile: (file: PreviewFile) => void;
  cursor: {
    visible: boolean;
    pos: { line: number; column: number };
  };
  /** Read-only badge shown in the header, e.g. "Version 5 snapshot". */
  badge?: string | null;
  /** Shown when there is no file to display. */
  emptyMessage?: string;
}

export function CodePane({
  files,
  activeFile,
  isSending,
  onSelectFile,
  cursor,
  badge = null,
  emptyMessage = 'Describe the app you want to build.',
}: CodePaneProps) {
  const rawContent = activeFile?.content ?? files[0]?.content ?? emptyMessage;
  const isTruncated = rawContent.length > MAX_CODE_PREVIEW_CHARS;
  const displayContent = isTruncated ? rawContent.slice(0, MAX_CODE_PREVIEW_CHARS) : rawContent;

  const codeScrollRef = useRef<HTMLPreElement | null>(null);
  // While the agent streams, the pane follows the cursor so the line being
  // written stays visible. A manual scroll up pauses following; a new run
  // re-enables it.
  const followCursorRef = useRef(true);

  useEffect(() => {
    if (isSending) followCursorRef.current = true;
  }, [isSending]);

  useEffect(() => {
    if (!isSending || !cursor.visible || !followCursorRef.current) return;
    const pre = codeScrollRef.current;
    if (!pre) return;
    const cursorTop = cursorOffsetTop(cursor.pos.line);
    if (cursorTop > pre.scrollTop + pre.clientHeight - 40) {
      // Keep ~80px of lookahead below the cursor as it descends.
      pre.scrollTop = cursorTop - pre.clientHeight + 80;
    }
  }, [cursor.pos.line, cursor.visible, isSending]);

  return (
    <div className="flex min-h-0 flex-1 bg-background-subtle">
      <div className="w-44 shrink-0 overflow-y-auto border-r border-white/10 py-2">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onSelectFile(file)}
            className={cn(
              'flex w-full items-center gap-2 truncate px-3 py-1.5 text-left text-[11px] text-foreground-secondary hover:bg-white/5 hover:text-foreground',
              activeFile?.path === file.path && 'bg-white/10 text-foreground',
            )}
          >
            {activeFile?.path === file.path && isSending ? (
              <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
            ) : (
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{file.path}</span>
          </button>
        ))}
      </div>
      <div className="relative min-w-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-background-muted px-4 py-2 font-mono text-[11px] text-foreground-secondary">
          <span className="truncate">
            {activeFile?.path ?? files[0]?.path ?? 'No generated files'}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-full border border-warning/40 bg-warning-light px-2 py-0.5 font-sans text-[10px] text-warning">
              {badge}
            </span>
          ) : null}
        </div>
        <pre
          ref={codeScrollRef}
          onWheel={(event) => {
            // Scrolling up is the user taking over; stop auto-following until
            // the next generation run.
            if (event.deltaY < 0) followCursorRef.current = false;
          }}
          onTouchMove={() => {
            followCursorRef.current = false;
          }}
          className="relative max-h-[600px] min-h-full overflow-auto p-4 font-mono text-xs leading-5 text-[#d4d4d4]"
        >
          <code>{displayContent}</code>
          {isSending && cursor.visible && (
            <div
              className="pointer-events-none absolute left-4 top-4 z-20 flex items-center"
              style={{
                transform: `translateY(${Math.max(0, cursor.pos.line - 1) * 20}px)`,
                transition: 'transform 0.1s linear',
              }}
            >
              <span className="h-4 w-0.5 animate-pulse bg-primary" />
              <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
                AI
              </span>
            </div>
          )}
        </pre>
        {isTruncated && (
          <div className="sticky bottom-0 border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            File truncated for display ({rawContent.length.toLocaleString()} chars). Open in preview
            or download to see full content.
          </div>
        )}
      </div>
    </div>
  );
}
