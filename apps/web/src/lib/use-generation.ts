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
import { isSovereignOverlayPath } from '@/lib/preview-startup';
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

/**
 * A file the user attached to the prompt. `content` is already read client-side
 * (the server only accepts text, caps each part at 100 KB, and enforces a 512 KB
 * total budget).
 */
export interface GenerationAttachment {
  path: string;
  content: string;
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
    // The live mirror is read (never written) to snapshot the content a streamed
    // file had before the run touched it — see `trackProvisional` in `send`.
    | 'files'
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
  /**
   * Starts a run. A send that is rejected before it starts (no prompt or
   * direction response, no model/provider, or a run already in flight) is a
   * no-op that leaves the user's prompt and attachments untouched — the prompt
   * bar mirrors these same guards so it never clears what was not sent.
   */
  send: (
    messageOverride?: string,
    directionResponseOverride?: GenerateDirectionResponse,
    editTargetOverride?: GenerationEditTarget,
    attachments?: GenerationAttachment[],
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

/** Cap for the raw provider text kept in a failure message's detail. */
const MAX_ERROR_DETAIL_CHARS = 2000;

/**
 * Provider failures arrive as raw JSON/HTML bodies — a rejected API key dumps the
 * whole response. The chat shows a clean sentence instead; the unfiltered text is
 * only kept in the message's collapsed `thinking` detail, truncated so a huge
 * provider dump cannot bloat the transcript.
 */
function formatErrorDetail(detail: string): string {
  const trimmed = detail.trim();
  return trimmed.length > MAX_ERROR_DETAIL_CHARS
    ? `${trimmed.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
    : trimmed;
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
  // Set synchronously on acceptance, unlike `isSending`: two sends in the same
  // tick would both read the pre-render `isSending === false`.
  const inFlightRef = useRef(false);
  // The server never persists a failure notice, so a failed run's message has to
  // survive the history refetch that the same failure triggers. Without this the
  // notice would flash and be wiped by the next history sync.
  const runFailureRef = useRef<ChatMessage | null>(null);
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
    // The old run's `finally` will bail out (it is no longer the current run), so
    // the in-flight flag has to be released here or every later send is rejected.
    inFlightRef.current = false;
    runFailureRef.current = null;
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
    const fromHistory = (history ?? []).map(mapHistoryMessage);
    const failure = runFailureRef.current;
    setLocalMessages(failure ? [...fromHistory, failure] : fromHistory);
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
    async (
      messageOverride?: string,
      directionResponseOverride?: GenerateDirectionResponse,
      editTargetOverride?: GenerationEditTarget,
      attachments?: GenerationAttachment[],
    ) => {
      const text = messageOverride?.trim() ?? '';
      if (
        (!text && !directionResponseOverride) ||
        inFlightRef.current ||
        isSending ||
        !selectedModel ||
        !selectedProvider
      ) {
        return;
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      inFlightRef.current = true;
      // An explicit override (in-preview quick edit) wins; otherwise use the
      // currently selected element (if any) as the edit target.
      const currentEditTarget = editTargetOverride ?? editTargetRef.current;
      const runtime = previewRef.current;

      // Streamed file content reaches the sandbox before the filesystem action
      // that commits it does, so a run stopped mid-file would otherwise leave a
      // syntactically incomplete file behind. This mirrors the server's own
      // provisional-originals bookkeeping: the first optimistic write for a path
      // records the content the client last knew as committed (null when the file
      // did not exist) so that path can be rolled back.
      const provisionalOriginals = new Map<string, string | null>();
      // Only a server terminal event (`ready` / `questions`) proves the buffered
      // previews match something the server accepts.
      let serverSettled = false;

      const trackProvisional = (path: string) => {
        if (provisionalOriginals.has(path)) return;
        // Injected preview scripts never come from the server; recording one as
        // "new" would make a rollback delete it from the container.
        if (isSovereignOverlayPath(path)) return;
        provisionalOriginals.set(path, runtime.files.get(path) ?? null);
      };

      const discardProvisionalWrites = () => {
        if (provisionalOriginals.size === 0) return;
        const originals = new Map(provisionalOriginals);
        provisionalOriginals.clear();
        // Re-queueing the committed content replaces the buffered fragments, and
        // the throttled write path pushes the committed text back into the
        // container — a fragment that already landed there is repaired this way.
        for (const [path, original] of originals) {
          runtime.applyFilePreview(
            original === null
              ? { operation: 'delete', path }
              : { operation: 'update', path, content: original },
          );
        }
        // The code pane reads `activeFile`, not the file mirror, so the streamed
        // fragment has to be replaced there too.
        setActiveFile((current) => {
          if (!current || !originals.has(current.path)) return current;
          const original = originals.get(current.path) ?? null;
          return original === null ? null : { ...current, content: original, line: 1, column: 0 };
        });
      };

      const resyncFromServer = () => {
        // Deliberately not awaited: the refetches must not hold `isSending` true
        // until they settle, and a failing refetch must not replace the run's own
        // error with a query error.
        void Promise.all([
          onVersionsRefetchRef.current(),
          onHistoryRefetchRef.current(),
          onFilesRefetchRef.current(),
        ]).catch(() => undefined);
      };

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
      if (!editTargetOverride) onClearEditTargetRef.current?.();
      runFailureRef.current = null;
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
            ...(attachments && attachments.length > 0 ? { files: attachments } : {}),
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
            // The server persisted this path as part of a completed file action,
            // so it is no longer provisional: an abort must not roll it back.
            provisionalOriginals.delete(event.data.path);
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
            if (event.data.operation === 'delete') {
              // Rollback of a previewed-but-uncommitted file.
              runtime.applyFilePreview(event.data);
              return;
            }
            if (event.data.content !== undefined) {
              trackProvisional(event.data.path);
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
            // Server terminal event: the buffered previews are not fragments to
            // be thrown away, and a stale failure notice must not come back.
            serverSettled = true;
            discardProvisionalWrites();
            runFailureRef.current = null;
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
            trackProvisional(event.data.path);
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
          // The event carries the full authoritative file set: nothing that was
          // streamed is provisional any more, and nothing is left to roll back.
          serverSettled = true;
          provisionalOriginals.clear();
          runFailureRef.current = null;
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

        // A stream that ends without a terminal event (dropped connection, server
        // restart) leaves the buffered previews unverified — treat that like a
        // stop rather than flushing a possibly truncated fragment.
        if (!serverSettled) {
          if (abortControllerRef.current === abortController) discardProvisionalWrites();
          resyncFromServer();
        }
      } catch (error) {
        setLocalMessages((previous) => previous.filter((message) => message.id !== optimisticId));
        const aborted =
          (error instanceof Error && error.name === 'AbortError') || abortController.signal.aborted;
        if (abortControllerRef.current === abortController) {
          // A run superseded by a newer one must not touch the runtime: the newer
          // run is already streaming its own previews into it.
          discardProvisionalWrites();
        }
        if (!aborted) {
          onRestoreInputRef.current?.(text);
          const detail = error instanceof Error ? error.message : 'Failed to generate the app.';
          const failureMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'system',
            // Provider failures are raw JSON/HTML dumps; the transcript gets a
            // clean sentence, with the unfiltered text only in the collapsed
            // detail below.
            content: 'Generation failed. Check your API key and model settings, then try again.',
            timestamp: new Date(),
            model: `${selectedProvider}:${selectedModel}`,
            thinking: formatErrorDetail(detail),
          };
          runFailureRef.current = failureMessage;
          setLocalMessages((previous) => [...previous, failureMessage]);
        }
        // The server commits files and versions mid-run and keeps them on failure
        // ("Completed changes were kept"), so the code pane, preview and version
        // timeline are stale until they are refetched.
        resyncFromServer();
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
          inFlightRef.current = false;
          setIsSending(false);
          setGenerationPhase(null);
          setLiveThinking(null);
          setLiveStepTitle(null);
          if (!abortController.signal.aborted) {
            setAgentLiveMessage('Agent finished');
          }
        }
        // Only a run that ended on a server terminal event may write its buffered
        // previews. After a stop — or a run superseded by a newer one — the buffer
        // still holds a truncated fragment the server never committed, and
        // flushing it is what left an unparseable file in the sandbox.
        if (serverSettled && !abortController.signal.aborted) {
          try {
            await runtime.flushPendingWrites();
          } catch {
            // WC write failure must not leave send UI stuck or clobber a newer run.
          }
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
