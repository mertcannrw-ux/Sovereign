'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { ChatMessage } from '@app-builder/shared';
import { consumeGenerationStream } from '@/lib/generation-stream';
import type {
  DesignDirectionsEventData,
  FileProgressEvent,
  GenerationPhaseEvent,
} from '@/lib/generation-stream';
import type { ClarifyingQuestion } from '@/lib/generation-protocol';
import type { UsePreviewRuntimeResult } from '@/lib/use-preview-runtime';

export interface GenerateDirectionResponse {
  action: 'select' | 'skip' | 'regenerate';
  setId: string;
  directionId?: string;
}

export interface GenerationEditTarget {
  tagName: string;
  id: string | null;
  className: string;
  text: string;
  selector: string;
  sourceFile: string;
  outerHTML: string;
}

export interface GenerationHistoryMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string | Date;
  model: string | null;
  toolCalls?: unknown;
  tokenUsage?: unknown;
  thinking?: string | null;
}

export interface UseGenerationOptions {
  projectId: string;
  selectedModel: string;
  selectedProvider: string | undefined;
  reasoningEffort: string;
  editTarget: GenerationEditTarget | null;
  preview: Pick<
    UsePreviewRuntimeResult,
    | 'applyFilePreview'
    | 'applyFileOperation'
    | 'applyFiles'
    | 'applyImmediateWrite'
    | 'flushPendingWrites'
    | 'handleRuntimeRequest'
  >;
  history: GenerationHistoryMessage[] | undefined;
  onHistoryRefetch: () => Promise<unknown>;
  onVersionsRefetch: () => Promise<unknown>;
  onFilesRefetch: () => Promise<unknown>;
  onClearEditTarget?: () => void;
  onClearInput?: () => void;
  onRestoreInput?: (text: string) => void;
}

export interface UseGenerationResult {
  isSending: boolean;
  generationPhase: GenerationPhaseEvent | null;
  liveThinking: string | null;
  liveStepTitle: string | null;
  agentLiveMessage: string;
  activeFile: FileProgressEvent | null;
  setActiveFile: Dispatch<SetStateAction<FileProgressEvent | null>>;
  localMessages: ChatMessage[];
  currentVersion: number;
  setCurrentVersion: Dispatch<SetStateAction<number>>;
  clarifyingQuestions: ClarifyingQuestion[];
  clarificationAnswers: string[];
  clarificationStep: number;
  customClarificationAnswer: string;
  setCustomClarificationAnswer: (value: string) => void;
  isCustomClarification: boolean;
  setIsCustomClarification: (value: boolean) => void;
  isReviewingClarifications: boolean;
  setIsReviewingClarifications: (value: boolean) => void;
  setClarificationStep: Dispatch<SetStateAction<number>>;
  activeDesignDirections: DesignDirectionsEventData | null;
  setActiveDesignDirections: Dispatch<SetStateAction<DesignDirectionsEventData | null>>;
  send: (
    messageOverride?: string,
    directionResponseOverride?: GenerateDirectionResponse,
  ) => Promise<void>;
  stop: () => void;
  answerClarification: (answer: string) => void;
  cancelClarifications: () => void;
  submitClarifications: () => void;
}

function isTokenUsage(value: unknown): value is ChatMessage['tokenUsage'] {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'promptTokens' in value &&
    typeof value.promptTokens === 'number' &&
    'completionTokens' in value &&
    typeof value.completionTokens === 'number' &&
    'totalTokens' in value &&
    typeof value.totalTokens === 'number'
  );
}

function mapHistoryMessage(message: GenerationHistoryMessage): ChatMessage {
  return {
    id: message.id,
    role:
      message.role === 'user' || message.role === 'assistant' || message.role === 'system'
        ? message.role
        : 'system',
    content: message.content,
    timestamp: new Date(message.timestamp),
    model: message.model ?? '',
    tokenUsage: isTokenUsage(message.tokenUsage) ? message.tokenUsage : undefined,
    toolCalls: Array.isArray(message.toolCalls)
      ? (message.toolCalls as ChatMessage['toolCalls'])
      : undefined,
    thinking: message.thinking ?? undefined,
  };
}

export function useGeneration({
  projectId,
  selectedModel,
  selectedProvider,
  reasoningEffort,
  editTarget,
  preview,
  history,
  onHistoryRefetch,
  onVersionsRefetch,
  onFilesRefetch,
  onClearEditTarget,
  onClearInput,
  onRestoreInput,
}: UseGenerationOptions): UseGenerationResult {
  const [isSending, setIsSending] = useState(false);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [generationPhase, setGenerationPhase] = useState<GenerationPhaseEvent | null>(null);
  const [activeFile, setActiveFile] = useState<FileProgressEvent | null>(null);
  const [liveThinking, setLiveThinking] = useState<string | null>(null);
  const [liveStepTitle, setLiveStepTitle] = useState<string | null>(null);
  const [agentLiveMessage, setAgentLiveMessage] = useState('');
  const [clarifyingQuestions, setClarifyingQuestions] = useState<ClarifyingQuestion[]>([]);
  const [clarificationAnswers, setClarificationAnswers] = useState<string[]>([]);
  const [clarificationStep, setClarificationStep] = useState(0);
  const [customClarificationAnswer, setCustomClarificationAnswer] = useState('');
  const [isCustomClarification, setIsCustomClarification] = useState(false);
  const [isReviewingClarifications, setIsReviewingClarifications] = useState(false);
  const [activeDesignDirections, setActiveDesignDirections] =
    useState<DesignDirectionsEventData | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const seenProjectIdRef = useRef(projectId);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const editTargetRef = useRef(editTarget);
  editTargetRef.current = editTarget;
  const onHistoryRefetchRef = useRef(onHistoryRefetch);
  onHistoryRefetchRef.current = onHistoryRefetch;
  const onVersionsRefetchRef = useRef(onVersionsRefetch);
  onVersionsRefetchRef.current = onVersionsRefetch;
  const onFilesRefetchRef = useRef(onFilesRefetch);
  onFilesRefetchRef.current = onFilesRefetch;
  const onClearEditTargetRef = useRef(onClearEditTarget);
  onClearEditTargetRef.current = onClearEditTarget;
  const onClearInputRef = useRef(onClearInput);
  onClearInputRef.current = onClearInput;
  const onRestoreInputRef = useRef(onRestoreInput);
  onRestoreInputRef.current = onRestoreInput;

  useEffect(() => {
    if (seenProjectIdRef.current === projectId) return;
    seenProjectIdRef.current = projectId;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
    setGenerationPhase(null);
    setActiveFile(null);
    setLiveThinking(null);
    setLiveStepTitle(null);
    setAgentLiveMessage('');
    setLocalMessages([]);
    setCurrentVersion(0);
    setClarifyingQuestions([]);
    setClarificationAnswers([]);
    setClarificationStep(0);
    setCustomClarificationAnswer('');
    setIsCustomClarification(false);
    setIsReviewingClarifications(false);
    setActiveDesignDirections(null);
  }, [projectId]);

  useEffect(() => {
    setLocalMessages((history ?? []).map(mapHistoryMessage));
  }, [history]);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsSending(false);
    setGenerationPhase(null);
    setLiveThinking(null);
    setLiveStepTitle(null);
    setAgentLiveMessage('Agent stopped');
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const send = useCallback(
    async (messageOverride?: string, directionResponseOverride?: GenerateDirectionResponse) => {
      const text = messageOverride?.trim() ?? '';
      if ((!text && !directionResponseOverride) || isSending || !selectedModel || !selectedProvider)
        return;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const currentEditTarget = editTargetRef.current;
      const runtime = previewRef.current;

      const optimisticId = crypto.randomUUID();
      const userMessage: ChatMessage = {
        id: optimisticId,
        role: 'user',
        content: text,
        timestamp: new Date(),
        model: `${selectedProvider}:${selectedModel}`,
      };

      setLocalMessages((previous) => [...previous, userMessage]);
      onClearInputRef.current?.();
      onClearEditTargetRef.current?.();
      setIsSending(true);
      setAgentLiveMessage('Agent started');
      setGenerationPhase({ phase: 'planning', label: 'Planning your app' });
      setActiveFile(null);
      setLiveThinking(null);
      setLiveStepTitle(null);
      setClarifyingQuestions([]);
      setActiveDesignDirections(null);
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            projectId,
            message: text,
            modelName: selectedModel,
            modelProvider: selectedProvider,
            reasoningEffort: reasoningEffort === 'auto' ? undefined : reasoningEffort,
            ...(currentEditTarget ? { editTarget: currentEditTarget } : {}),
            ...(directionResponseOverride ? { directionResponse: directionResponseOverride } : {}),
          }),
        });

        await consumeGenerationStream(response, async (event) => {
          if (event.type === 'phase') {
            setGenerationPhase(event.data);
            return;
          }
          if (event.type === 'step') {
            if (event.data.kind === 'thinking' && event.data.detail) {
              setLiveThinking(event.data.detail);
            }
            if (event.data.title) {
              setLiveStepTitle(event.data.title);
              setGenerationPhase({ phase: 'building', label: event.data.title });
            }
            return;
          }
          if (event.type === 'file-operation') {
            const label =
              event.data.operation === 'delete'
                ? `Deleting ${event.data.path}`
                : `Writing ${event.data.path}`;
            setGenerationPhase({ phase: 'building', label });
            runtime.applyFileOperation(event.data);
            return;
          }
          if (event.type === 'image-job') {
            if (event.data.status === 'running') {
              setGenerationPhase({
                phase: 'building',
                label: `Generating image for ${event.data.semanticUse}`,
              });
            }
            return;
          }
          if (event.type === 'file-preview') {
            if (event.data.operation !== 'delete' && event.data.content !== undefined) {
              setActiveFile({
                path: event.data.path,
                content: event.data.content,
                line: 1,
                column: 0,
              });
              runtime.applyFilePreview(event.data);
            }
            return;
          }
          if (event.type === 'design-directions') {
            setActiveDesignDirections(event.data);
            return;
          }
          if (event.type === 'thinking') {
            setLiveThinking(event.data.content);
            return;
          }
          if (event.type === 'questions') {
            setClarifyingQuestions(event.data.questions);
            setClarificationAnswers([]);
            setClarificationStep(0);
            setCustomClarificationAnswer('');
            setIsCustomClarification(false);
            setIsReviewingClarifications(false);
            setLocalMessages((previous) => [
              ...previous.filter((message) => message.id !== optimisticId),
              {
                id: event.data.userMessage.id,
                role: 'user',
                content: event.data.userMessage.content,
                timestamp: new Date(event.data.userMessage.timestamp),
                model: event.data.userMessage.model ?? `${selectedProvider}:${selectedModel}`,
              },
              {
                id: event.data.assistantMessage.id,
                role: 'assistant',
                content: event.data.assistantMessage.content,
                timestamp: new Date(event.data.assistantMessage.timestamp),
                model: event.data.assistantMessage.model ?? `${selectedProvider}:${selectedModel}`,
              },
            ]);
            await onHistoryRefetchRef.current();
            return;
          }
          if (event.type === 'file-start') {
            setActiveFile({ path: event.data.path, content: '', line: 1, column: 0 });
            return;
          }
          if (event.type === 'file-progress') {
            setActiveFile(event.data);
            runtime.applyFilePreview({
              operation: 'update',
              path: event.data.path,
              content: event.data.content,
            });
            return;
          }
          if (event.type === 'file-complete') {
            await runtime.applyImmediateWrite([event.data]);
            return;
          }
          if (event.type === 'failed') throw new Error(event.data.message);

          if (event.type !== 'ready') return;
          await runtime.applyFiles(event.data.files);
          const primaryFile =
            event.data.files.find((file) => file.path === 'index.html') ??
            event.data.files.find((file) => file.path.endsWith('.html')) ??
            event.data.files[0];
          if (primaryFile) {
            setActiveFile({
              path: primaryFile.path,
              content: primaryFile.content,
              line: 1,
              column: 0,
            });
          }
          setLocalMessages((previous) => [
            ...previous.filter((message) => message.id !== optimisticId),
            {
              id: event.data.userMessage.id,
              role: 'user',
              content: event.data.userMessage.content,
              timestamp: new Date(event.data.userMessage.timestamp),
              model: event.data.userMessage.model ?? `${selectedProvider}:${selectedModel}`,
            },
            {
              id: event.data.assistantMessage.id,
              role: 'assistant',
              content: event.data.assistantMessage.content,
              timestamp: new Date(event.data.assistantMessage.timestamp),
              model: event.data.assistantMessage.model ?? `${selectedProvider}:${selectedModel}`,
              tokenUsage: event.data.assistantMessage.tokenUsage,
              ...(event.data.thinking ? { thinking: event.data.thinking } : {}),
            },
          ]);
          setCurrentVersion(event.data.versionNumber);
          await Promise.all([
            onVersionsRefetchRef.current(),
            onHistoryRefetchRef.current(),
            onFilesRefetchRef.current(),
          ]);
        });
      } catch (error) {
        setLocalMessages((previous) => previous.filter((message) => message.id !== optimisticId));
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || abortController.signal.aborted)
        ) {
          return;
        }
        onRestoreInputRef.current?.(text);
        const message = error instanceof Error ? error.message : 'Failed to generate the app.';
        setLocalMessages((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: 'system',
            content: `**Error:** ${message}`,
            timestamp: new Date(),
            model: `${selectedProvider}:${selectedModel}`,
          },
        ]);
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
          setIsSending(false);
          setGenerationPhase(null);
          setLiveThinking(null);
          setLiveStepTitle(null);
          if (!abortController.signal.aborted) {
            setAgentLiveMessage('Agent finished');
          }
        }
        try {
          await runtime.flushPendingWrites();
        } catch {
          // WC write failure must not leave send UI stuck or clobber a newer run.
        }
      }
    },
    [isSending, selectedModel, selectedProvider, projectId, reasoningEffort],
  );

  const answerClarification = useCallback(
    (answer: string) => {
      const nextAnswers = [...clarificationAnswers];
      nextAnswers[clarificationStep] = answer.trim();
      setClarificationAnswers(nextAnswers);
      setCustomClarificationAnswer('');
      setIsCustomClarification(false);
      if (clarificationStep >= clarifyingQuestions.length - 1) {
        setIsReviewingClarifications(true);
      } else {
        setClarificationStep((step) => step + 1);
      }
    },
    [clarificationAnswers, clarificationStep, clarifyingQuestions.length],
  );

  const cancelClarifications = useCallback(() => {
    setClarifyingQuestions([]);
    setClarificationAnswers([]);
    setClarificationStep(0);
    setCustomClarificationAnswer('');
    setIsCustomClarification(false);
    setIsReviewingClarifications(false);
  }, []);

  const submitClarifications = useCallback(() => {
    const response = clarifyingQuestions
      .map(
        (item, index) => `${index + 1}. ${item.question}\nAnswer: ${clarificationAnswers[index]}`,
      )
      .join('\n\n');
    cancelClarifications();
    void send(`Here are my answers to your clarifying questions:\n\n${response}`);
  }, [cancelClarifications, clarificationAnswers, clarifyingQuestions, send]);

  return {
    isSending,
    generationPhase,
    liveThinking,
    liveStepTitle,
    agentLiveMessage,
    activeFile,
    setActiveFile,
    localMessages,
    currentVersion,
    setCurrentVersion,
    clarifyingQuestions,
    clarificationAnswers,
    clarificationStep,
    customClarificationAnswer,
    setCustomClarificationAnswer,
    isCustomClarification,
    setIsCustomClarification,
    isReviewingClarifications,
    setIsReviewingClarifications,
    setClarificationStep,
    activeDesignDirections,
    setActiveDesignDirections,
    send,
    stop,
    answerClarification,
    cancelClarifications,
    submitClarifications,
  };
}
