'use client';

import { useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { cn } from '@app-builder/ui/utils';
import { X } from 'lucide-react';

// ── Types ──────────────────────────────────────────

interface CodeFile {
  path: string;
  content: string;
}

interface CodeEditorProps {
  files: CodeFile[];
  activeFile: string;
  onSelectFile: (path: string) => void;
  onFileChange: (path: string, content: string) => void;
  onCloseFile?: (path: string) => void;
  className?: string;
}

// ── Syntax Highlighting ───────────────────────────

// Token categories with their highlight colors
const KEYWORDS: Record<string, true> = {
  import: true,
  export: true,
  from: true,
  default: true,
  const: true,
  let: true,
  var: true,
  function: true,
  return: true,
  if: true,
  else: true,
  for: true,
  while: true,
  do: true,
  switch: true,
  case: true,
  break: true,
  continue: true,
  class: true,
  interface: true,
  type: true,
  extends: true,
  implements: true,
  async: true,
  await: true,
  yield: true,
  new: true,
  delete: true,
  typeof: true,
  instanceof: true,
  in: true,
  of: true,
  throw: true,
  try: true,
  catch: true,
  finally: true,
  true: true,
  false: true,
  null: true,
  undefined: true,
  void: true,
  this: true,
  super: true,
  as: true,
  is: true,
  satisfies: true,
  keyof: true,
  any: true,
  string: true,
  number: true,
  boolean: true,
  never: true,
  unknown: true,
  declare: true,
  namespace: true,
  module: true,
  enum: true,
  private: true,
  protected: true,
  public: true,
  readonly: true,
  static: true,
  abstract: true,
  override: true,
  get: true,
  set: true,
  with: true,
  debugger: true,
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Single-pass tokenizer over the RAW source: markup inserted for one token is
// never scanned again, so spans can't nest or mangle on subsequent edits.
// Order matters: comments before strings, strings before numbers/keywords.
const TOKEN_RE =
  /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\.)*`)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|0[xX][0-9a-fA-F]+|0[bB][01]+)\b|(<\/?[a-zA-Z_$][\w$]*)|(\/?>)|(\b[a-zA-Z_$][\w$]*\b)/g;

function highlightCode(code: string): string {
  let html = '';
  let lastIndex = 0;
  for (const match of code.matchAll(TOKEN_RE)) {
    html += escapeHtml(code.slice(lastIndex, match.index));
    const token = match[0];
    // Groups: 1 comment, 2 block comment, 3 template, 4 double-quoted,
    // 5 single-quoted, 6 number, 7 JSX tag, 8 closing tag, 9 identifier.
    const [, comment, blockComment, template, doubleQuoted, singleQuoted, numberToken, jsxTag, closingTag, word] =
      match;
    let className: string | null = null;
    if (comment || blockComment) className = 'hl-comment';
    else if (template || doubleQuoted || singleQuoted) className = 'hl-string';
    else if (numberToken) className = 'hl-number';
    else if (jsxTag || closingTag) className = 'hl-tag';
    else if (word && KEYWORDS[word]) className = 'hl-keyword';

    if (className) {
      html += `<span class="${className}">${escapeHtml(token)}</span>`;
    } else {
      html += escapeHtml(token);
    }
    lastIndex = match.index + token.length;
  }
  html += escapeHtml(code.slice(lastIndex));
  return html;
}

// ── Get file extension for display ─────────────────

function getFileLabel(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

// ── Main Component ─────────────────────────────────

export function CodeEditor({
  files,
  activeFile,
  onSelectFile,
  onFileChange,
  onCloseFile,
  className,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const activeFileData = useMemo(
    () => files.find((f) => f.path === activeFile),
    [files, activeFile],
  );

  const lineCount = activeFileData ? activeFileData.content.split('\n').length : 0;

  // Gutter line numbers
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1),
    [lineCount],
  );

  // Highlighted HTML - deferred so large files don't block typing.
  const deferredContent = useDeferredValue(activeFileData?.content ?? '');
  const highlightedHtml = useMemo(() => {
    if (!activeFileData) return '';
    // Use deferred value for the heavy regex pass to keep keystrokes responsive.
    const source = deferredContent !== '' || activeFileData.content === '' ? deferredContent : activeFileData.content;
    return highlightCode(source);
  }, [activeFileData, deferredContent]);

  // Sync scroll between textarea, highlight layer, and gutter
  const handleScroll = useCallback(() => {
    const editor = editorRef.current;
    const highlight = highlightRef.current;
    const gutter = gutterRef.current;
    if (!editor || !highlight || !gutter) return;

    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
    gutter.scrollTop = editor.scrollTop;
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onFileChange(activeFile, e.target.value);
    },
    [activeFile, onFileChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab key inserts 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        onFileChange(activeFile, newValue);

        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    },
    [activeFile, onFileChange],
  );

  // ── Empty state ──────────────────────────────────

  if (files.length === 0) {
    return (
      <div className={cn('flex flex-1 items-center justify-center bg-background', className)}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-background-muted">
            <svg
              className="h-6 w-6 text-foreground-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground-secondary">No files open</p>
          <p className="mt-1 text-xs text-foreground-muted">
            Select a file from the file tree or generate code to begin editing
          </p>
        </div>
      </div>
    );
  }

  // ── No file selected ─────────────────────────────

  if (!activeFileData) {
    return (
      <div className={cn('flex flex-1 items-center justify-center bg-background', className)}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-background-muted">
            <svg
              className="h-6 w-6 text-foreground-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground-secondary">No file selected</p>
          <p className="mt-1 text-xs text-foreground-muted">
            Click a file in the file tree to view and edit its source code
          </p>
        </div>
      </div>
    );
  }

  // ── Editor ───────────────────────────────────────

  return (
    <div className={cn('flex flex-col bg-background', className)}>
      {/* File tabs */}
      <div className="flex items-center overflow-x-auto border-b border-border bg-background-subtle">
        {files.map((file) => {
          const isActive = file.path === activeFile;
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => onSelectFile(file.path)}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs transition-colors',
                isActive
                  ? 'border-b-2 border-b-primary bg-background pb-[5px] text-foreground'
                  : 'bg-background-subtle text-foreground-muted hover:bg-background hover:text-foreground-secondary',
              )}
            >
              <span className="max-w-[140px] truncate">{getFileLabel(file.path)}</span>
              {onCloseFile && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFile(file.path);
                  }}
                  className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-background-muted group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Editor area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Line numbers gutter */}
        <div
          ref={gutterRef}
          className="select-none overflow-hidden border-r border-border bg-background-subtle py-3 text-right text-xs leading-5 text-foreground-muted"
          style={{
            minWidth: `${Math.max(3, lineCount.toString().length) * 10 + 16}px`,
          }}
          aria-hidden="true"
        >
          {lineNumbers.map((n) => (
            <div key={n} className="px-2">
              {n}
            </div>
          ))}
        </div>

        {/* Highlight layer (visible behind transparent textarea) */}
        <pre
          className="code-editor"
          style={{
            paddingLeft: `${Math.max(3, lineCount.toString().length) * 10 + 24}px`,
            paddingRight: '16px',
            paddingTop: '12px',
            paddingBottom: '12px',
            margin: 0,
            whiteSpace: 'pre',
            wordWrap: 'normal',
            overflow: 'hidden',
            // Match textarea sizing
            minHeight: '100%',
            width: '100%',
            boxSizing: 'border-box',
          }}
          dangerouslySetInnerHTML={{
            __html: activeFileData.content
              ? highlightedHtml.replace(/<(\/?)script\b/gi, '<$1\u200Bscript') + '\n'
              : '<br/>',
          }}
        />

        {/* Actual textarea for editing */}
        <textarea
          ref={editorRef}
          value={activeFileData.content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          className={cn(
            'relative z-10 flex-1 resize-none border-0 bg-transparent font-mono text-xs leading-5',
            'text-transparent caret-foreground',
            'focus:outline-none focus:ring-0',
            'placeholder:text-foreground-muted',
          )}
          style={{
            paddingLeft: `${Math.max(3, lineCount.toString().length) * 10 + 24}px`,
            paddingRight: '16px',
            paddingTop: '12px',
            paddingBottom: '12px',
            minHeight: '100%',
            width: '100%',
            boxSizing: 'border-box',
            overflow: 'auto',
            whiteSpace: 'pre',
            wordWrap: 'normal',
          }}
          placeholder="Start editing..."
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-border bg-background-subtle px-3 py-1 text-xs text-foreground-muted">
        <span>{activeFile}</span>
        <span>Lines: {lineCount}</span>
      </div>

      {/* Syntax highlighting styles via inline style tag */}
      <style>{`
        .hl-keyword { color: #2563EB; font-weight: 500; }
        .hl-string { color: #059669; }
        .hl-number { color: #D97706; }
        .hl-comment { color: #9CA3AF; font-style: italic; }
        .hl-tag { color: #7C3AED; }
      `}</style>
    </div>
  );
}
