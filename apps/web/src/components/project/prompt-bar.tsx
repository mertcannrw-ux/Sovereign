'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { cn } from '@app-builder/ui/utils';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Crosshair,
  Paperclip,
  Plus,
  Square,
  X,
  Zap,
} from 'lucide-react';
import type { SelectedPreviewElement, ModelGroup } from '@/components/project/types';
import type { GenerationAttachment } from '@/lib/use-generation';

/** Matches the server's per-attachment cap in `/api/generate` (100 KB). */
const MAX_ATTACHMENT_BYTES = 100 * 1024;
/** Matches the server's total attachment budget (512 KB). */
const MAX_ATTACHMENTS_TOTAL_BYTES = 512 * 1024;

/**
 * Extensions we can read as UTF-8 text. Binary formats (images, archives) would
 * be mangled by a text read, so they are rejected up front with a clear reason.
 */
const TEXT_ATTACHMENT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.csv',
  '.tsv',
  '.log',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.graphql',
  '.gql',
  '.env.example',
];

function isTextAttachment(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (file.type === 'application/json' || file.type === 'application/xml') return true;
  const lower = file.name.toLowerCase();
  return TEXT_ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  mistral: 'Mistral',
  groq: 'Groq',
  ollama: 'Ollama',
  custom: 'Custom',
};

export const REASONING_LEVELS = [
  { value: 'auto', label: 'Auto' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const REASONING_OFF_PROVIDERS = new Set(['openai', 'groq']);

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type SubMenu = 'root' | 'models' | 'effort';

export interface PromptBarAttachment {
  name: string;
  content: string;
  byteSize: number;
}

export interface PromptBarProps {
  input: string;
  onInputChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isSending: boolean;
  selectedModelKey: string;
  selectedModel: string;
  selectedProvider: string | undefined;
  onSelectModelKey: (key: string) => void;
  reasoningEffort: string;
  onReasoningEffortChange: (value: string) => void;
  availableModels: ModelGroup[];
  selectedPreviewElement: SelectedPreviewElement | null;
  onClearSelectedElement: () => void;
  clarifyingLocked: boolean;
  /** Receives the typed text plus any readable attachments, then clears them. */
  onSend: (message: string, attachments: GenerationAttachment[]) => void;
  onStop: () => void;
}

export function PromptBar({
  input,
  onInputChange,
  inputRef,
  isSending,
  selectedModelKey,
  selectedModel,
  selectedProvider,
  onSelectModelKey,
  reasoningEffort,
  onReasoningEffortChange,
  availableModels,
  selectedPreviewElement,
  onClearSelectedElement,
  clarifyingLocked,
  onSend,
  onStop,
}: PromptBarProps) {
  const [showModelPopover, setShowModelPopover] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenu>('root');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<PromptBarAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const triggerId = useId();
  const dialogId = useId();

  const filteredModels = useMemo(() => {
    if (!modelSearchQuery.trim()) return availableModels;
    const query = modelSearchQuery.toLowerCase().trim();
    return availableModels
      .map((group) => ({
        ...group,
        models: group.models.filter(
          (model) =>
            model.toLowerCase().includes(query) || group.label.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.models.length > 0);
  }, [availableModels, modelSearchQuery]);

  const modelOptions = useMemo(
    () =>
      filteredModels.flatMap((group) =>
        group.models.map((model) => ({
          key: `${group.provider}:${model}`,
          model,
          group: group.label,
        })),
      ),
    [filteredModels],
  );

  const effortOptions = useMemo(
    () =>
      REASONING_LEVELS.filter(
        (level) => level.value !== 'off' || REASONING_OFF_PROVIDERS.has(selectedProvider ?? ''),
      ),
    [selectedProvider],
  );

  const closePopover = useCallback(() => {
    setShowModelPopover(false);
    setActiveSubMenu('root');
    setModelSearchQuery('');
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showModelPopover) return;
    const container = popoverRef.current;
    if (!container) return;

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.tabIndex !== -1 && !el.hasAttribute('disabled'),
      );

    const listbox = container.querySelector<HTMLElement>('[role="listbox"]');
    (listbox ?? focusable()[0])?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePopover();
        return;
      }
      if (event.key !== 'Tab') return;
      const els = focusable();
      if (els.length === 0) return;
      const firstEl = els[0]!;
      const lastEl = els[els.length - 1]!;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [showModelPopover, activeSubMenu, closePopover]);

  useEffect(() => {
    if (activeSubMenu === 'models') {
      const selected = modelOptions.findIndex((option) => option.key === selectedModelKey);
      setActiveOptionIndex(selected >= 0 ? selected : 0);
    } else if (activeSubMenu === 'effort') {
      const selected = effortOptions.findIndex((option) => option.value === reasoningEffort);
      setActiveOptionIndex(selected >= 0 ? selected : 0);
    } else {
      setActiveOptionIndex(0);
    }
  }, [activeSubMenu, modelOptions, selectedModelKey, effortOptions, reasoningEffort]);

  const moveActiveOption = (delta: number, count: number) => {
    if (count === 0) return;
    setActiveOptionIndex((current) => (current + delta + count) % count);
  };

  const onListboxKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    count: number,
    onSelectIndex: (index: number) => void,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActiveOption(1, count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveOption(-1, count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveOptionIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveOptionIndex(Math.max(0, count - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectIndex(activeOptionIndex);
    }
  };

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      const errors: string[] = [];
      const accepted: PromptBarAttachment[] = [];
      let total = attachedFiles.reduce((sum, item) => sum + item.byteSize, 0);

      for (const file of files) {
        if (!isTextAttachment(file)) {
          errors.push(`${file.name}: only text-based files can be attached.`);
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          errors.push(
            `${file.name}: ${formatBytes(file.size)} exceeds the ${formatBytes(MAX_ATTACHMENT_BYTES)} per-file limit.`,
          );
          continue;
        }
        if (total + file.size > MAX_ATTACHMENTS_TOTAL_BYTES) {
          errors.push(
            `${file.name}: would exceed the ${formatBytes(MAX_ATTACHMENTS_TOTAL_BYTES)} total attachment limit.`,
          );
          continue;
        }
        try {
          const content = await file.text();
          accepted.push({ name: file.name, content, byteSize: file.size });
          total += file.size;
        } catch {
          errors.push(`${file.name}: could not be read.`);
        }
      }

      if (accepted.length > 0) {
        setAttachedFiles((previous) => [...previous, ...accepted]);
      }
      setAttachmentError(errors.length > 0 ? errors.join(' ') : null);
    },
    [attachedFiles],
  );

  const send = useCallback(
    (message: string) => {
      onSend(
        message,
        attachedFiles.map((file) => ({ path: file.name, content: file.content })),
      );
      setAttachedFiles([]);
      setAttachmentError(null);
    },
    [attachedFiles, onSend],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  };

  const listboxLabel =
    activeSubMenu === 'effort'
      ? 'Reasoning effort'
      : activeSubMenu === 'models'
        ? 'Models'
        : 'Model settings';

  if (clarifyingLocked) {
    return (
      <div className="relative mx-auto max-w-3xl">
        <p className="py-2 text-center text-xs text-foreground-muted">
          Complete or cancel the clarification above to continue chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-3xl">
      <div hidden aria-hidden="true">
        <div role="group" aria-label="Generation mode">
          <button type="button" disabled aria-pressed="true">
            Build
          </button>
          <button type="button" disabled>
            Plan
          </button>
        </div>
      </div>

      {showModelPopover && (
        <div
          ref={popoverRef}
          id={dialogId}
          className="absolute bottom-full right-12 z-30 mb-3 w-80 overflow-hidden rounded-2xl border border-white/15 bg-[#1a1a1c] p-3 shadow-2xl backdrop-blur-xl"
          role="dialog"
          aria-label="Model and reasoning settings"
        >
          {activeSubMenu === 'root' && (
            <div
              role="listbox"
              id={listboxId}
              aria-labelledby={triggerId}
              aria-activedescendant={`${listboxId}-root-${activeOptionIndex}`}
              tabIndex={0}
              onKeyDown={(event) =>
                onListboxKeyDown(event, 2, (index) =>
                  setActiveSubMenu(index === 0 ? 'models' : 'effort'),
                )
              }
              className="space-y-1"
            >
              <button
                type="button"
                id={`${listboxId}-root-0`}
                role="option"
                tabIndex={-1}
                aria-selected={activeOptionIndex === 0}
                onClick={() => setActiveSubMenu('models')}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5',
                  activeOptionIndex === 0 && 'bg-white/5',
                )}
              >
                <span className="text-foreground-secondary">Model</span>
                <div className="flex items-center gap-1 text-white">
                  <span>{selectedModel || 'Select model'}</span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                </div>
              </button>

              <button
                type="button"
                id={`${listboxId}-root-1`}
                role="option"
                tabIndex={-1}
                aria-selected={activeOptionIndex === 1}
                onClick={() => setActiveSubMenu('effort')}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5',
                  activeOptionIndex === 1 && 'bg-white/5',
                )}
              >
                <span className="text-foreground-secondary">Effort</span>
                <div className="flex items-center gap-1 text-white">
                  <span className="capitalize">
                    {REASONING_LEVELS.find((r) => r.value === reasoningEffort)?.label ?? 'Auto'}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                </div>
              </button>
            </div>
          )}

          {activeSubMenu === 'models' && (
            <div>
              <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-xs font-semibold text-white">
                <button
                  type="button"
                  onClick={() => setActiveSubMenu('root')}
                  className="flex items-center gap-1 text-foreground-muted hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <span>Select Model</span>
              </div>

              <div className="relative mb-2.5">
                <input
                  type="text"
                  placeholder="Search models..."
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveActiveOption(1, modelOptions.length);
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveActiveOption(-1, modelOptions.length);
                      return;
                    }
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const option = modelOptions[activeOptionIndex];
                    if (!option) return;
                    onSelectModelKey(option.key);
                    setActiveSubMenu('root');
                  }}
                  className="h-9 w-full rounded-lg border border-white/20 bg-[#121214] px-3 pr-7 text-xs font-medium text-white placeholder:text-foreground-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                />
                {modelSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setModelSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-muted hover:text-white"
                    aria-label="Clear model search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div
                role="listbox"
                id={listboxId}
                aria-label={listboxLabel}
                aria-activedescendant={
                  modelOptions[activeOptionIndex]
                    ? `${listboxId}-model-${activeOptionIndex}`
                    : undefined
                }
                tabIndex={0}
                onKeyDown={(event) =>
                  onListboxKeyDown(event, modelOptions.length, (index) => {
                    const option = modelOptions[index];
                    if (!option) return;
                    onSelectModelKey(option.key);
                    setActiveSubMenu('root');
                  })
                }
                className="max-h-52 space-y-2 overflow-y-auto pr-1"
              >
                {filteredModels.length > 0 ? (
                  filteredModels.map((group) => (
                    <div
                      key={group.provider}
                      role="group"
                      aria-label={group.label}
                      className="space-y-0.5"
                    >
                      <div
                        className="px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted"
                        aria-hidden="true"
                      >
                        {group.label}
                      </div>
                      {group.models.map((model) => {
                        const key = `${group.provider}:${model}`;
                        const optionIndex = modelOptions.findIndex((option) => option.key === key);
                        const isSelected = key === selectedModelKey;
                        const isActive = optionIndex === activeOptionIndex;
                        return (
                          <button
                            key={key}
                            type="button"
                            id={`${listboxId}-model-${optionIndex}`}
                            role="option"
                            tabIndex={-1}
                            aria-selected={isSelected}
                            onClick={() => {
                              onSelectModelKey(key);
                              setActiveSubMenu('root');
                            }}
                            className={cn(
                              'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                              isSelected
                                ? 'bg-primary/15 font-medium text-primary'
                                : 'text-foreground-secondary hover:bg-white/5 hover:text-white',
                              isActive && !isSelected && 'bg-white/5',
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <Zap className="h-3.5 w-3.5" />
                              <span>{model}</span>
                            </div>
                            {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-center text-xs text-foreground-muted">
                    No models found
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSubMenu === 'effort' && (
            <div>
              <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-xs font-semibold text-white">
                <button
                  type="button"
                  onClick={() => setActiveSubMenu('root')}
                  className="flex items-center gap-1 text-foreground-muted hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <span>Reasoning Effort</span>
              </div>
              <div
                role="listbox"
                id={listboxId}
                aria-label={listboxLabel}
                aria-activedescendant={`${listboxId}-effort-${activeOptionIndex}`}
                tabIndex={0}
                onKeyDown={(event) =>
                  onListboxKeyDown(event, effortOptions.length, (index) => {
                    const option = effortOptions[index];
                    if (!option) return;
                    onReasoningEffortChange(option.value);
                    setActiveSubMenu('root');
                  })
                }
                className="space-y-1"
              >
                {effortOptions.map((level, index) => {
                  const isSelected = level.value === reasoningEffort;
                  return (
                    <button
                      key={level.value}
                      type="button"
                      id={`${listboxId}-effort-${index}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={isSelected}
                      onClick={() => {
                        onReasoningEffortChange(level.value);
                        setActiveSubMenu('root');
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                        isSelected
                          ? 'bg-primary/15 font-medium text-primary'
                          : 'text-foreground-secondary hover:bg-white/5 hover:text-white',
                        index === activeOptionIndex && !isSelected && 'bg-white/5',
                      )}
                    >
                      <span>{level.label}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-[#161618] p-3 shadow-2xl transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/40">
        {selectedPreviewElement && (
          <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            <span className="text-foreground-secondary">
              Editing{' '}
              <span className="font-mono font-medium text-foreground">
                {selectedPreviewElement.selector}
              </span>
            </span>
            <button
              type="button"
              onClick={onClearSelectedElement}
              className="ml-auto rounded p-0.5 text-foreground-muted hover:text-white"
              aria-label="Clear selected element"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Message the agent"
          placeholder={
            selectedPreviewElement
              ? `Describe the change for this ${selectedPreviewElement.tagName}…`
              : 'Describe what you want to build or change…'
          }
          rows={2}
          className="max-h-36 min-h-[44px] w-full resize-none border-none bg-transparent px-2 text-sm text-white shadow-none outline-none ring-0 placeholder:text-foreground-muted focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
        />

        <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) void handleAttachFiles(files);
                // Allow re-selecting the same file after removing it.
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#A1A1A1] transition-all hover:bg-white/[0.08] hover:text-white active:scale-95"
              title="Append images or files"
              aria-label="Append images or files"
            >
              <Plus className="h-5 w-5" strokeWidth={2.2} />
            </button>

            {attachedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white"
              >
                <Paperclip className="h-3 w-3 text-primary" aria-hidden="true" />
                <span className="max-w-[120px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-foreground-muted hover:text-white"
                  aria-label={`Remove attachment ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {attachmentError ? (
              <p
                role="alert"
                className="max-w-[280px] text-right text-[11px] leading-tight text-warning"
              >
                {attachmentError}
              </p>
            ) : null}
            <button
              ref={triggerRef}
              id={triggerId}
              type="button"
              onClick={() => {
                setShowModelPopover((prev) => !prev);
                setActiveSubMenu('root');
              }}
              className={cn(
                'flex items-center rounded-full bg-transparent px-3 py-1.5 text-xs transition-all hover:bg-white/[0.08]',
                showModelPopover && 'bg-white/[0.10] ring-1 ring-white/15',
              )}
              aria-haspopup="dialog"
              aria-expanded={showModelPopover}
              aria-controls={dialogId}
            >
              <span className="font-medium text-[#E5E5E5]">{selectedModel || 'Select Model'}</span>
              <span className="ml-2.5 font-normal text-[#9A9A9A]">
                {REASONING_LEVELS.find((r) => r.value === reasoningEffort)?.label ?? 'Auto'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (isSending) {
                  onStop();
                } else {
                  send(input);
                }
              }}
              disabled={isSending ? false : !input.trim() || !selectedModel || !selectedProvider}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition-all',
                isSending
                  ? 'bg-red-500 text-white shadow-md'
                  : input.trim() && selectedModel && selectedProvider
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90'
                    : 'cursor-not-allowed bg-white/10 text-white/30',
              )}
              aria-label={isSending ? 'Stop agent' : 'Send message'}
              aria-live="polite"
            >
              {isSending ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
