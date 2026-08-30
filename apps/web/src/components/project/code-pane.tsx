'use client';

import { cn } from '@app-builder/ui/utils';
import { FileCode2 } from 'lucide-react';
import type { PreviewFile } from '@/lib/use-webcontainer';
import type { FileProgressEvent } from '@/lib/generation-stream';

const MAX_CODE_PREVIEW_CHARS = 50000;

export interface CodePaneProps {
  files: PreviewFile[];
  activeFile: FileProgressEvent | null;
  isSending: boolean;
  onSelectFile: (file: PreviewFile) => void;
  cursor: {
    visible: boolean;
    pos: { line: number; column: number };
  };
}

export function CodePane({ files, activeFile, isSending, onSelectFile, cursor }: CodePaneProps) {
  const rawContent =
    activeFile?.content ?? files[0]?.content ?? 'Describe the app you want to build.';
  const isTruncated = rawContent.length > MAX_CODE_PREVIEW_CHARS;
  const displayContent = isTruncated ? rawContent.slice(0, MAX_CODE_PREVIEW_CHARS) : rawContent;

  return (
    <div className="flex min-h-0 flex-1 bg-[#111]">
      <div className="w-44 shrink-0 overflow-y-auto border-r border-white/10 py-2">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onSelectFile(file)}
            className={cn(
              'flex w-full items-center gap-2 truncate px-3 py-1.5 text-left text-[11px] text-[#9ca3af] hover:bg-white/5 hover:text-white',
              activeFile?.path === file.path && 'bg-white/10 text-white',
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
        <div className="sticky top-0 z-10 border-b border-white/10 bg-[#181818] px-4 py-2 font-mono text-[11px] text-[#9ca3af]">
          {activeFile?.path ?? files[0]?.path ?? 'No generated files'}
        </div>
        <pre className="max-h-[600px] min-h-full overflow-auto p-4 font-mono text-xs leading-5 text-[#d4d4d4]">
          <code>{displayContent}</code>
        </pre>
        {isTruncated && (
          <div className="sticky bottom-0 border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            File truncated for display ({rawContent.length.toLocaleString()} chars). Open in preview
            or download to see full content.
          </div>
        )}
        {isSending && cursor.visible && (
          <div
            className="pointer-events-none absolute left-4 z-20 flex items-center"
            style={{
              transform: `translateY(${42 + Math.max(0, cursor.pos.line - 1) * 20}px)`,
              transition: 'transform 0.1s linear',
            }}
          >
            <span className="h-4 w-0.5 animate-pulse bg-primary" />
            <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
              AI
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
