'use client';

import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChatMessage } from '@app-builder/shared';
import { DesignDirectionCards } from '@/components/design-direction-cards';
import type {
  DesignDirectionsEventData,
  FileProgressEvent,
  GenerationPhaseEvent,
} from '@/lib/generation-stream';
import type { ClarifyingQuestion } from '@/lib/generation-protocol';
import type { AgentStep } from '@/lib/agent-protocol';
import type { GenerateDirectionResponse } from '@/lib/use-generation';
import {
  AlertCircle,
  Bot,
  ChevronRight,
  Clock,
  Eye,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Trash2,
  User,
} from 'lucide-react';

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageContent({ content, thinking }: { content: string; thinking?: string | null }) {
  const [showThinking, setShowThinking] = useState(false);
  const parts = useMemo(() => content.split(/(```\w*\n[\s\S]*?```)/g), [content]);

  return (
    <div className="space-y-2">
      {thinking && (
        <div className="overflow-hidden rounded-lg border border-border/50 bg-background-muted/30">
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground-secondary"
          >
            <span
              className={cn(
                'h-3 w-3 transition-transform duration-200',
                showThinking && 'rotate-90',
              )}
            >
              <ChevronRight className="h-3 w-3" />
            </span>
            {showThinking ? 'Hide thinking' : 'Show thinking'}
          </button>
          {showThinking && (
            <div className="border-t border-border/50 px-3 py-2.5">
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-foreground-muted">
                {thinking}
              </pre>
            </div>
          )}
        </div>
      )}
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const firstLine = part.indexOf('\n');
          const lang = part.slice(3, firstLine).trim() || 'code';
          const code = part.slice(firstLine + 1, -3);
          return (
            <div key={i} className="code-block">
              <div className="code-block__header">
                <span className="text-xs text-foreground-muted">{lang}</span>
              </div>
              <pre className="code-block__content">
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        return (
          <p
            key={i}
            className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary"
          >
            {part}
          </p>
        );
      })}
    </div>
  );
}

function isAgentStep(item: unknown): item is AgentStep {
  return (
    typeof item === 'object' &&
    item !== null &&
    'kind' in item &&
    'title' in item &&
    typeof (item as Record<string, unknown>).title === 'string'
  );
}

function ToolStepsDisplay({ toolCalls }: { toolCalls: unknown }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!Array.isArray(toolCalls)) return null;
  const steps = toolCalls.filter(isAgentStep);
  if (steps.length === 0) return null;

  const fileWrites = steps.filter((s) => s.kind === 'write' || s.kind === 'edit').length;
  const fileReads = steps.filter((s) => s.kind === 'read').length;
  const fileDeletes = steps.filter((s) => s.kind === 'delete').length;

  const summaryParts: string[] = [];
  if (fileWrites > 0)
    summaryParts.push(`${fileWrites} file ${fileWrites === 1 ? 'change' : 'changes'}`);
  if (fileReads > 0) summaryParts.push(`${fileReads} file ${fileReads === 1 ? 'read' : 'reads'}`);
  if (fileDeletes > 0)
    summaryParts.push(`${fileDeletes} file ${fileDeletes === 1 ? 'deleted' : 'deletes'}`);

  const summaryText =
    summaryParts.length > 0 ? summaryParts.join(', ') : `${steps.length} execution steps`;

  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-background-muted/30">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground-secondary"
      >
        <div className="flex items-center gap-2">
          <span className={cn('h-3 w-3 transition-transform duration-200', isOpen && 'rotate-90')}>
            <ChevronRight className="h-3 w-3" />
          </span>
          <span>{summaryText}</span>
        </div>
        <span className="text-[10px] text-foreground-muted/60">
          {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        </span>
      </button>

      {isOpen && (
        <div className="space-y-1.5 border-t border-border/50 p-2.5">
          {steps.map((step) => {
            const Icon =
              step.kind === 'write' || step.kind === 'edit'
                ? FileCode2
                : step.kind === 'read'
                  ? Eye
                  : step.kind === 'delete'
                    ? Trash2
                    : step.kind === 'image'
                      ? ImageIcon
                      : Bot;

            return (
              <div
                key={step.id}
                className="flex items-center justify-between rounded-md bg-background/50 px-2.5 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                  <span className="truncate font-mono text-[11px] text-foreground-secondary">
                    {step.title}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {step.detail && (
                    <span
                      className="line-clamp-1 max-w-[180px] text-[10px] text-foreground-muted"
                      title={step.detail}
                    >
                      {step.detail}
                    </span>
                  )}
                  {step.durationMs !== undefined && (
                    <span className="text-[10px] text-foreground-muted/60">
                      {step.durationMs}ms
                    </span>
                  )}
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  historyLoading: boolean;
  historyErrorMessage?: string;
  isSending: boolean;
  selectedModel: string;
  generationPhase: GenerationPhaseEvent | null;
  liveThinking: string | null;
  liveStepTitle: string | null;
  agentLiveMessage: string;
  activeFile: FileProgressEvent | null;
  clarifyingQuestions: ClarifyingQuestion[];
  clarificationAnswers: string[];
  clarificationStep: number;
  customClarificationAnswer: string;
  isCustomClarification: boolean;
  isReviewingClarifications: boolean;
  onCustomClarificationAnswerChange: (value: string) => void;
  onCustomClarificationToggle: (value: boolean) => void;
  onClarificationStepChange: (value: number | ((step: number) => number)) => void;
  onReviewingChange: (value: boolean) => void;
  onAnswerClarification: (answer: string) => void;
  onCancelClarifications: () => void;
  onSubmitClarifications: () => void;
  activeDesignDirections: DesignDirectionsEventData | null;
  onDirectionResponse: (response: GenerateDirectionResponse) => Promise<void>;
  onClearDesignDirections: () => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  footer: ReactNode;
}

export function ChatPanel({
  messages,
  historyLoading,
  historyErrorMessage,
  isSending,
  selectedModel,
  generationPhase,
  liveThinking,
  liveStepTitle,
  agentLiveMessage,
  activeFile,
  clarifyingQuestions,
  clarificationAnswers,
  clarificationStep,
  customClarificationAnswer,
  isCustomClarification,
  isReviewingClarifications,
  onCustomClarificationAnswerChange,
  onCustomClarificationToggle,
  onClarificationStepChange,
  onReviewingChange,
  onAnswerClarification,
  onCancelClarifications,
  onSubmitClarifications,
  activeDesignDirections,
  onDirectionResponse,
  onClearDesignDirections,
  messagesEndRef,
  footer,
}: ChatPanelProps) {
  const [showLiveThinking, setShowLiveThinking] = useState(true);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {agentLiveMessage}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveStepTitle ?? ''}
      </div>

      <div className="flex-1 overflow-y-auto">
        {historyLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          </div>
        )}
        {historyErrorMessage && !historyLoading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-error" />
            <p className="mb-1 text-sm font-medium text-foreground-secondary">
              Failed to load messages
            </p>
            <p className="text-xs text-foreground-muted">{historyErrorMessage}</p>
          </div>
        )}

        {!historyLoading && !historyErrorMessage && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-foreground-secondary">Ready to build</p>
            <p className="mt-1 max-w-xs text-xs text-foreground-muted">
              Add your API keys in Settings, then describe the app you want to create.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'chat-message',
              msg.role === 'user' ? 'chat-message--user' : 'chat-message--assistant',
            )}
          >
            <div className="mx-auto max-w-3xl space-y-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full',
                    msg.role === 'user'
                      ? 'bg-background-muted text-foreground-secondary'
                      : 'bg-primary/10 text-primary',
                  )}
                >
                  {msg.role === 'user' ? (
                    <User className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                </div>
                <span className="text-xs font-medium text-foreground-secondary">
                  {msg.role === 'user' ? 'You' : 'Assistant'}
                </span>
                <span className="flex items-center gap-1 text-xs text-foreground-muted">
                  <Clock className="h-3 w-3" />
                  {formatTime(new Date(msg.timestamp))}
                </span>
                <Badge variant="outline" className="ml-auto px-1.5 py-0 text-[10px]">
                  {msg.model}
                </Badge>
              </div>
              <div className="space-y-2 pl-8">
                {msg.toolCalls && <ToolStepsDisplay toolCalls={msg.toolCalls} />}
                <MessageContent content={msg.content} thinking={msg.thinking} />
              </div>
              {msg.tokenUsage && (
                <div className="pl-8 pt-1">
                  <span className="text-[10px] text-foreground-muted/60">
                    {msg.tokenUsage.totalTokens} tokens
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {clarifyingQuestions.length > 0 && !isSending && (
          <div className="chat-message chat-message--assistant">
            <div className="mx-auto max-w-3xl pl-8">
              <div className="overflow-hidden rounded-xl border border-primary/30 bg-primary/5">
                {!isReviewingClarifications ? (
                  (() => {
                    const item = clarifyingQuestions[clarificationStep];
                    if (!item) return null;
                    return (
                      <div className="p-4">
                        <div className="mb-4 flex items-center justify-between">
                          <p className="text-xs font-semibold text-primary">
                            Clarifying your request
                          </p>
                          <span className="text-[10px] text-foreground-muted">
                            {clarificationStep + 1} of {clarifyingQuestions.length}
                          </span>
                        </div>
                        <h3 className="mb-4 text-base font-semibold leading-6 text-foreground">
                          {item.question}
                        </h3>
                        <div className="space-y-2">
                          {item.options.map((option, optionIndex) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => onAnswerClarification(option)}
                              className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left text-sm text-foreground-secondary transition-colors hover:border-primary/60 hover:bg-background-muted"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-foreground-muted">
                                {optionIndex + 1}
                              </span>
                              {option}
                            </button>
                          ))}
                          {!isCustomClarification ? (
                            <button
                              type="button"
                              onClick={() => onCustomClarificationToggle(true)}
                              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-transparent px-3 py-3 text-left text-sm text-foreground-muted transition-colors hover:border-primary/60 hover:text-foreground-secondary"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold">
                                4
                              </span>
                              Write my own answer
                            </button>
                          ) : (
                            <div className="space-y-2 rounded-lg border border-primary/40 bg-background p-3">
                              <Textarea
                                autoFocus
                                value={customClarificationAnswer}
                                onChange={(event) =>
                                  onCustomClarificationAnswerChange(event.target.value)
                                }
                                placeholder="Enter your answer…"
                                className="min-h-20 resize-none text-sm"
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    onCustomClarificationToggle(false);
                                    onCustomClarificationAnswerChange('');
                                  }}
                                >
                                  Back
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={!customClarificationAnswer.trim()}
                                  onClick={() => onAnswerClarification(customClarificationAnswer)}
                                >
                                  Use answer
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="mt-4 flex justify-between border-t border-border/50 pt-3">
                          <Button variant="ghost" size="sm" onClick={onCancelClarifications}>
                            Cancel
                          </Button>
                          {clarificationStep > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onClarificationStepChange((step) => step - 1)}
                            >
                              Previous
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="p-4">
                    <p className="text-xs font-semibold text-primary">Review your answers</p>
                    <h3 className="mt-1 text-base font-semibold text-foreground">
                      Ready to continue?
                    </h3>
                    <div className="mt-4 space-y-3">
                      {clarifyingQuestions.map((item, index) => (
                        <button
                          key={item.question}
                          type="button"
                          onClick={() => {
                            onClarificationStepChange(() => index);
                            onReviewingChange(false);
                          }}
                          className="block w-full rounded-lg border border-border bg-background p-3 text-left hover:border-primary/50"
                        >
                          <span className="block text-xs font-medium text-foreground-secondary">
                            {index + 1}. {item.question}
                          </span>
                          <span className="mt-1 block text-sm text-primary">
                            {clarificationAnswers[index]}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-end gap-2 border-t border-border/50 pt-4">
                      <Button variant="ghost" onClick={onCancelClarifications}>
                        Cancel
                      </Button>
                      <Button onClick={onSubmitClarifications}>Submit answers</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeDesignDirections && !isSending && (
          <div className="chat-message chat-message--assistant">
            <div className="mx-auto max-w-3xl pl-8">
              <DesignDirectionCards
                data={activeDesignDirections}
                onSelect={async (directionId) => {
                  const setId = activeDesignDirections.id;
                  onClearDesignDirections();
                  await onDirectionResponse({
                    action: 'select',
                    setId,
                    directionId,
                  });
                }}
                onSkip={async () => {
                  const setId = activeDesignDirections.id;
                  onClearDesignDirections();
                  await onDirectionResponse({
                    action: 'skip',
                    setId,
                  });
                }}
                onRegenerate={async () => {
                  const setId = activeDesignDirections.id;
                  onClearDesignDirections();
                  await onDirectionResponse({
                    action: 'regenerate',
                    setId,
                  });
                }}
              />
            </div>
          </div>
        )}

        {isSending && (
          <div className="chat-message chat-message--assistant">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-medium text-foreground-secondary">Assistant</span>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {selectedModel}
                </Badge>
              </div>
              <div className="pl-8 pt-2">
                <div className="overflow-hidden rounded-lg border border-border/40 bg-background-muted/20">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-foreground-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="flex-1">
                      {generationPhase?.label ?? 'Starting generation'}
                    </span>
                    {liveThinking && (
                      <button
                        type="button"
                        onClick={() => setShowLiveThinking((v) => !v)}
                        className="flex items-center gap-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground-secondary"
                      >
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 transition-transform duration-200',
                            showLiveThinking && 'rotate-90',
                          )}
                        />
                        {showLiveThinking ? 'Hide reasoning' : 'Show reasoning'}
                      </button>
                    )}
                  </div>
                  {showLiveThinking && liveThinking && (
                    <div className="border-t border-border/40 px-3 py-2.5">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-foreground-muted">
                        {liveThinking}
                      </pre>
                    </div>
                  )}
                </div>
                {activeFile && (
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background-muted px-2.5 py-2 font-mono text-[11px]">
                    <FileCode2 className="h-3.5 w-3.5 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                      {activeFile.path}
                    </span>
                    <span className="text-foreground-muted">
                      Ln {activeFile.line}, Col {activeFile.column}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border bg-background-subtle p-2.5 sm:p-3">{footer}</div>
    </div>
  );
}
