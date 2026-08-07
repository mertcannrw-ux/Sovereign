'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ChatMessage } from '@app-builder/shared';
import { VersionTimeline } from '@/components/version-timeline';
import type { VersionTimelineEntry } from '@/components/version-timeline';
import { trpc } from '@/lib/trpc/client';
import { consumeGenerationStream } from '@/lib/generation-stream';
import type { FileProgressEvent, GenerationPhaseEvent } from '@/lib/generation-stream';
import type { ClarifyingQuestion } from '@/lib/generation-protocol';
import { useWebContainer } from '@/lib/use-webcontainer';
import type { PreviewFile } from '@/lib/use-webcontainer';
import { getPreviewCursorTarget, useSmoothCursor } from '@/lib/use-smooth-cursor';
import {
  ArrowLeft,
  Settings,
  Rocket,
  Send,
  Bot,
  User,
  Clock,
  Code,
  Eye,
  AlertCircle,
  Loader2,
  FileCode2,
  MousePointer2,
  RefreshCw,
  Search,
  X,
  Crosshair,
  Square,
  ChevronRight,
  ArrowUp,
  Zap,
  Plus,
  Paperclip,
  Check,
} from 'lucide-react';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  mistral: 'Mistral',
  groq: 'Groq',
  ollama: 'Ollama',
  custom: 'Custom',
};

const REASONING_LEVELS = [
  { value: 'auto', label: 'Auto' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const REASONING_OFF_PROVIDERS = new Set(['openai', 'groq']);

// ── Format timestamp ────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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


// ── Code block parser ───────────────────────────────────────────────────

function MessageContent({ content, thinking }: { content: string; thinking?: string | null }) {
  const [showThinking, setShowThinking] = useState(false);

  return (
    <div className="space-y-2">
      {thinking && (
        <div className="overflow-hidden rounded-lg border border-border/50 bg-background-muted/30">
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-foreground-muted hover:text-foreground-secondary transition-colors"
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
      {content.split(/(```\w*\n[\s\S]*?```)/g).map((part, i) => {
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


interface SelectedPreviewElement {
  tagName: string;
  id: string | null;
  className: string;
  text: string;
  selector: string;
  sourceFile: string;
  outerHTML: string;
}

const VISUAL_EDITOR_SOURCE = 'sovereign-visual-editor';

// ── Main Workspace Page ─────────────────────────────────────────────────

export default function ProjectWorkspace() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const projectId = params.id ?? '';
  const { status } = useSession();

  const projectQuery = trpc.projects.getById.useQuery({ id: projectId });
  const modelsQuery = trpc.apiKeys.listModels.useQuery();
  const historyQuery = trpc.chat.getHistory.useQuery({ projectId });
  const versionsQuery = trpc.chat.getVersions.useQuery({ projectId });
  const filesQuery = trpc.projects.files.useQuery({ id: projectId });
  const restoreMutation = trpc.chat.restoreVersion.useMutation();
  const updateProjectMutation = trpc.projects.update.useMutation();

  const [projectName, setProjectName] = useState('Untitled Project');
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState('preview');
  const [reasoningEffort, setReasoningEffort] = useState('auto');
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [isRestoring, setIsRestoring] = useState(false);
  const [liveFiles, setLiveFiles] = useState<PreviewFile[]>([]);
  const [generationPhase, setGenerationPhase] = useState<GenerationPhaseEvent | null>(null);
  const [activeFile, setActiveFile] = useState<FileProgressEvent | null>(null);
  const [liveThinking, setLiveThinking] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [visiblePreviewSlot, setVisiblePreviewSlot] = useState<0 | 1>(0);
  const [previewSlotRevisions, setPreviewSlotRevisions] = useState<[number | null, number | null]>([0, null]);
  const [showLiveThinking, setShowLiveThinking] = useState(false);
  const [clarifyingQuestions, setClarifyingQuestions] = useState<ClarifyingQuestion[]>([]);
  const [clarificationAnswers, setClarificationAnswers] = useState<string[]>([]);
  const [clarificationStep, setClarificationStep] = useState(0);
  const [customClarificationAnswer, setCustomClarificationAnswer] = useState('');
  const [isCustomClarification, setIsCustomClarification] = useState(false);
  const [isReviewingClarifications, setIsReviewingClarifications] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedPreviewElement, setSelectedPreviewElement] = useState<SelectedPreviewElement | null>(null);
  const [showModelPopover, setShowModelPopover] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<'root' | 'models' | 'effort'>('root');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; file?: File }>>([]);
  const availableModels = useMemo(
    () =>
      (modelsQuery.data ?? [])
        .filter((group) => group.models.length > 0)
        .map((group) => ({
          provider: group.provider,
          label: PROVIDER_LABELS[group.provider as keyof typeof PROVIDER_LABELS] ?? group.provider,
          models: group.models,
        })),
    [modelsQuery.data],
  );
  const [modelSearchQuery, setModelSearchQuery] = useState('');
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSandboxWriteRef = useRef(0);
  const lastPreviewRefreshRef = useRef(0);
  const visiblePreviewSlotRef = useRef<0 | 1>(0);
  const previewFramesRef = useRef<Array<HTMLIFrameElement | null>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSending(false);
    setGenerationPhase(null);
    setLiveThinking(null);
  }, []);


  const sandbox = useWebContainer(filesQuery.data ?? [], status === 'authenticated' && filesQuery.isSuccess);

  useEffect(() => {
    if (!sandbox.url || previewKey === 0) return;
    const loadingSlot = visiblePreviewSlotRef.current === 0 ? 1 : 0;
    setPreviewSlotRevisions((current) => {
      const next: [number | null, number | null] = [...current];
      next[loadingSlot] = previewKey;
      return next;
    });
  }, [previewKey, sandbox.url]);
  const setPreviewEditMode = useCallback((enabled: boolean) => {
    for (const frame of previewFramesRef.current) {
      frame?.contentWindow?.postMessage(
        { source: VISUAL_EDITOR_SOURCE, type: 'set-edit-mode', enabled },
        '*',
      );
    }
  }, []);

  useEffect(() => {
    setPreviewEditMode(isEditMode);
    if (!isEditMode) setSelectedPreviewElement(null);
  }, [isEditMode, setPreviewEditMode, visiblePreviewSlot]);

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent) => {
      if (!event.data || event.data.source !== VISUAL_EDITOR_SOURCE) return;
      const fromPreview = previewFramesRef.current.some(
        (frame) => frame?.contentWindow === event.source,
      );
      if (!fromPreview) return;

      if (event.data.type === 'ready') {
        event.source?.postMessage(
          { source: VISUAL_EDITOR_SOURCE, type: 'set-edit-mode', enabled: isEditMode },
          { targetOrigin: '*' },
        );
        return;
      }
      if (event.data.type === 'selection-cleared') {
        setSelectedPreviewElement(null);
        return;
      }
      if (event.data.type === 'element-selected') {
        setSelectedPreviewElement(event.data.element as SelectedPreviewElement);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };

    window.addEventListener('message', handlePreviewMessage);
    return () => window.removeEventListener('message', handlePreviewMessage);
  }, [isEditMode]);
  const selectedProvider = selectedModelKey.split(':', 1)[0] || undefined;
  const selectedModel = selectedProvider ? selectedModelKey.slice(selectedProvider.length + 1) : '';
  useEffect(() => {
    if (reasoningEffort === 'off' && !REASONING_OFF_PROVIDERS.has(selectedProvider ?? '')) {
      setReasoningEffort('auto');
    }
  }, [reasoningEffort, selectedProvider]);
  const historyLoading = historyQuery.isLoading;
  const historyError = historyQuery.error;
  const versionsLoading = versionsQuery.isLoading;
  const displayedFiles = useMemo(() => {
    const files: PreviewFile[] = liveFiles.length > 0 ? liveFiles : (filesQuery.data ?? []);
    return [...files].sort((a, b) => {
      // `index.html` always first, then other HTML, then alphabetical
      const aScore = a.path === 'index.html' ? 0 : a.path.endsWith('.html') ? 1 : 2;
      const bScore = b.path === 'index.html' ? 0 : b.path.endsWith('.html') ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
      return a.path.localeCompare(b.path);
    });
  }, [liveFiles, filesQuery.data]);
  const smoothCursor = useSmoothCursor(
    activeFile ? { line: activeFile.line, column: activeFile.column } : null,
  );
  const previewCursorTarget = useMemo(
    () => activeFile?.path.toLowerCase().endsWith('.html')
      ? getPreviewCursorTarget(activeFile.content)
      : null,
    [activeFile],
  );

  useEffect(() => {
    if (!projectQuery.data) return;
    setProjectName(projectQuery.data.name);
  }, [projectQuery.data]);

  useEffect(() => {
    const history = historyQuery.data ?? [];
    setLocalMessages(
      history.map((message) => ({
        id: message.id,
        role:
          message.role === 'user' || message.role === 'assistant' || message.role === 'system'
            ? message.role
            : 'system',
        content: message.content,
        timestamp: new Date(message.timestamp),
        model: message.model,
        tokenUsage: isTokenUsage(message.tokenUsage) ? message.tokenUsage : undefined,
      })),
    );
  }, [historyQuery.data]);

  useEffect(() => {
    if (availableModels.length === 0) {
      setSelectedModelKey('');
      return;
    }

    const projectProvider = projectQuery.data?.modelProvider;
    const projectModel = projectQuery.data?.modelName;
    const projectKey = projectProvider && projectModel ? `${projectProvider}:${projectModel}` : '';
    const keys = availableModels.flatMap((group) =>
      group.models.map((model) => `${group.provider}:${model}`),
    );

    setSelectedModelKey((current) => {
      if (keys.includes(current)) return current;
      if (keys.includes(projectKey)) return projectKey;
      return keys[0] ?? '';
    });
  }, [modelsQuery.data, projectQuery.data?.modelName, projectQuery.data?.modelProvider]);

  const handleSend = useCallback(async (messageOverride?: string) => {
    const text = messageOverride?.trim() || input.trim();
    if (!text || isSending || !selectedModel || !selectedProvider) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const editTarget = selectedPreviewElement;

    const optimisticId = crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: optimisticId,
      role: 'user',
      content: text,
      timestamp: new Date(),
      model: `${selectedProvider}:${selectedModel}`,
    };

    setLocalMessages((previous) => [...previous, userMessage]);
    setInput('');
    setSelectedPreviewElement(null);
    setIsSending(true);
    setGenerationPhase({ phase: 'planning', label: 'Planning your app' });
    setActiveFile(null);
    setLiveThinking(null);
    setClarifyingQuestions([]);

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
          ...(editTarget ? { editTarget } : {}),
        }),
      });

      await consumeGenerationStream(response, async (event) => {
        if (event.type === 'phase') {
          setGenerationPhase(event.data);
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
          await historyQuery.refetch();
          return;
        }
        if (event.type === 'file-start') {
          setActiveFile({ path: event.data.path, content: '', line: 1, column: 0 });
          return;
        }
        if (event.type === 'file-progress') {
          setActiveFile(event.data);
          setLiveFiles((current) => [
            ...current.filter((file) => file.path !== event.data.path),
            { path: event.data.path, content: event.data.content },
          ]);
          const now = performance.now();
          if (now - lastSandboxWriteRef.current >= 120) {
            lastSandboxWriteRef.current = now;
            await sandbox.writeFiles([{ path: event.data.path, content: event.data.content }]);
            if (now - lastPreviewRefreshRef.current >= 500) {
              lastPreviewRefreshRef.current = now;
              setPreviewKey((key) => key + 1);
            }
          }
          return;
        }
        if (event.type === 'file-complete') {
          await sandbox.writeFiles([event.data]);
          setPreviewKey((key) => key + 1);
          return;
        }
        if (event.type === 'failed') throw new Error(event.data.message);

        await sandbox.writeFiles(event.data.files);
        setPreviewKey((key) => key + 1);
        // Select `index.html` so the code panel and preview show the entry point
        const primaryFile = event.data.files.find(file => file.path === 'index.html')
          ?? event.data.files.find(file => file.path.endsWith('.html'))
          ?? event.data.files[0];
        if (primaryFile) {
          setActiveFile({ path: primaryFile.path, content: primaryFile.content, line: 1, column: 0 });
        }
        setLiveFiles(event.data.files);
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
        await Promise.all([versionsQuery.refetch(), historyQuery.refetch(), filesQuery.refetch()]);
      });
    } catch (error) {
      setLocalMessages((previous) => previous.filter((message) => message.id !== optimisticId));
      if (error instanceof Error && (error.name === 'AbortError' || abortController.signal.aborted)) {
        return;
      }
      setInput(text);
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
      setIsSending(false);
      setGenerationPhase(null);
      setLiveThinking(null);
      abortControllerRef.current = null;
    }
  }, [
    input,
    isSending,
    selectedModel,
    selectedProvider,
    projectId,
    sandbox,
    reasoningEffort,
    versionsQuery,
    selectedPreviewElement,
  ]);

  const answerClarification = useCallback((answer: string) => {
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
  }, [clarificationAnswers, clarificationStep, clarifyingQuestions.length]);

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
      .map((item, index) => `${index + 1}. ${item.question}\nAnswer: ${clarificationAnswers[index]}`)
      .join('\n\n');
    cancelClarifications();
    void handleSend(`Here are my answers to your clarifying questions:\n\n${response}`);
  }, [cancelClarifications, clarificationAnswers, clarifyingQuestions, handleSend]);

  const handleRestoreVersion = useCallback(
    async (versionNumber: number) => {
      setIsRestoring(true);
      try {
        const restored = await restoreMutation.mutateAsync({ projectId, versionNumber });
        await sandbox.replaceFiles(displayedFiles, restored.files);
        setPreviewKey((k) => k + 1);
        setLiveFiles(restored.files);
        const primaryRestored = restored.files.find(f => f.path === 'index.html')
          ?? restored.files.find(f => f.path.endsWith('.html'))
          ?? restored.files[0];
        if (primaryRestored) {
          setActiveFile({ path: primaryRestored.path, content: primaryRestored.content, line: 1, column: 0 });
        }
        setCurrentVersion(restored.versionNumber);
        await Promise.all([versionsQuery.refetch(), filesQuery.refetch()]);
      } finally {
        setIsRestoring(false);
      }
    },
    [displayedFiles, filesQuery, projectId, restoreMutation, sandbox, versionsQuery],
  );

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages, isSending]);

  // Redirect when project not found
  useEffect(() => {
    if (projectQuery.error?.data?.code === 'NOT_FOUND') {
      router.push('/dashboard');
    }
  }, [projectQuery.error, router]);

  // Require auth
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    router.push('/auth/signin');
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const versionTimelineEntries: VersionTimelineEntry[] = (versionsQuery.data ?? []).map(
    (version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      createdAt: new Date(version.createdAt),
      fileCount: Object.keys(version.manifest as Record<string, string>).length,
      isRestore: false,
    }),
  );

  const effectiveVersion = currentVersion;
  const historyErrorMessage = historyError?.message;
  const messages = localMessages;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* ── Top Bar ─────────────────────── */}
      <header className="flex h-[68px] shrink-0 items-center gap-3.5 border-b border-border bg-background px-5 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg hover:bg-white/10"
          onClick={() => router.push('/dashboard')}
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-5 bg-border" />

        {/* Editable project name */}
        <input
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          onBlur={() => {
            const nextName = projectName.trim();
            if (nextName && nextName !== projectQuery.data?.name) {
              updateProjectMutation.mutate({ id: projectId, name: nextName });
            }
          }}
          className="max-w-[160px] border-none bg-transparent text-base font-bold tracking-tight text-white outline-none focus:ring-0 sm:max-w-[300px]"
          aria-label="Project name"
        />

        <div className="ml-auto flex items-center gap-3">
          {/* Deploy button */}
          <Button size="default" className="h-9 gap-2 rounded-lg px-4 text-xs font-semibold sm:text-sm shadow-sm">
            <Rocket className="h-4 w-4" />
            <span className="hidden sm:inline">Deploy</span>
          </Button>

          {/* Settings */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg hover:bg-white/10"
            onClick={() => router.push('/settings')}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── Version Timeline ─────────────── */}
      <div className="border-b border-border bg-background-subtle">
        <VersionTimeline
          versions={versionTimelineEntries}
          currentVersion={effectiveVersion}
          onSelectVersion={setCurrentVersion}
          onRestoreVersion={handleRestoreVersion}
          isLoading={versionsLoading || isRestoring}
        />
      </div>

      {/* ── Main workspace ──────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Chat Panel ───────────── */}
        <div className="flex w-full flex-col border-r border-border bg-background md:w-[42%] lg:w-[38%]">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            {/* Loading state */}
            {historyLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
              </div>
            )}
            {historyError && !historyLoading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <AlertCircle className="mb-3 h-8 w-8 text-error" />
                <p className="mb-1 text-sm font-medium text-foreground-secondary">
                  Failed to load messages
                </p>
                <p className="text-xs text-foreground-muted">{historyErrorMessage}</p>
              </div>
            )}

            {/* Empty state — fresh workspace */}
            {!historyLoading && !historyError && messages.length === 0 && (
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
              <div key={msg.id} className={cn('chat-message', msg.role === 'user' ? 'chat-message--user' : 'chat-message--assistant')}>
                <div className="mx-auto max-w-3xl space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={cn('flex h-6 w-6 items-center justify-center rounded-full', msg.role === 'user' ? 'bg-background-muted text-foreground-secondary' : 'bg-primary/10 text-primary')}>
                      {msg.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                    </div>
                    <span className="text-xs font-medium text-foreground-secondary">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                    <span className="flex items-center gap-1 text-xs text-foreground-muted"><Clock className="h-3 w-3" />{formatTime(new Date(msg.timestamp))}</span>
                    <Badge variant="outline" className="ml-auto px-1.5 py-0 text-[10px]">{msg.model}</Badge>
                  </div>
                  <div className="pl-8"><MessageContent content={msg.content} thinking={msg.thinking} /></div>
                  {msg.tokenUsage && <div className="pl-8 pt-1"><span className="text-[10px] text-foreground-muted/60">{msg.tokenUsage.totalTokens} tokens</span></div>}
                </div>
              </div>
            ))}

            {clarifyingQuestions.length > 0 && !isSending && (
              <div className="chat-message chat-message--assistant">
                <div className="mx-auto max-w-3xl pl-8">
                  <div className="overflow-hidden rounded-xl border border-primary/30 bg-primary/5">
                    {!isReviewingClarifications ? (() => {
                      const item = clarifyingQuestions[clarificationStep];
                      if (!item) return null;
                      return (
                        <div className="p-4">
                          <div className="mb-4 flex items-center justify-between">
                            <p className="text-xs font-semibold text-primary">Clarifying your request</p>
                            <span className="text-[10px] text-foreground-muted">{clarificationStep + 1} of {clarifyingQuestions.length}</span>
                          </div>
                          <h3 className="mb-4 text-base font-semibold leading-6 text-foreground">{item.question}</h3>
                          <div className="space-y-2">
                            {item.options.map((option, optionIndex) => (
                              <button key={option} type="button" onClick={() => answerClarification(option)} className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left text-sm text-foreground-secondary transition-colors hover:border-primary/60 hover:bg-background-muted">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-foreground-muted">{optionIndex + 1}</span>{option}
                              </button>
                            ))}
                            {!isCustomClarification ? (
                              <button type="button" onClick={() => setIsCustomClarification(true)} className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-transparent px-3 py-3 text-left text-sm text-foreground-muted transition-colors hover:border-primary/60 hover:text-foreground-secondary">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold">4</span>Write my own answer
                              </button>
                            ) : (
                              <div className="space-y-2 rounded-lg border border-primary/40 bg-background p-3">
                                <Textarea autoFocus value={customClarificationAnswer} onChange={(event) => setCustomClarificationAnswer(event.target.value)} placeholder="Enter your answer…" className="min-h-20 resize-none text-sm" />
                                <div className="flex justify-end gap-2">
                                  <Button variant="ghost" size="sm" onClick={() => { setIsCustomClarification(false); setCustomClarificationAnswer(''); }}>Back</Button>
                                  <Button size="sm" disabled={!customClarificationAnswer.trim()} onClick={() => answerClarification(customClarificationAnswer)}>Use answer</Button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="mt-4 flex justify-between border-t border-border/50 pt-3">
                            <Button variant="ghost" size="sm" onClick={cancelClarifications}>Cancel</Button>
                            {clarificationStep > 0 && <Button variant="ghost" size="sm" onClick={() => setClarificationStep((step) => step - 1)}>Previous</Button>}
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="p-4">
                        <p className="text-xs font-semibold text-primary">Review your answers</p>
                        <h3 className="mt-1 text-base font-semibold text-foreground">Ready to continue?</h3>
                        <div className="mt-4 space-y-3">
                          {clarifyingQuestions.map((item, index) => (
                            <button key={item.question} type="button" onClick={() => { setClarificationStep(index); setIsReviewingClarifications(false); }} className="block w-full rounded-lg border border-border bg-background p-3 text-left hover:border-primary/50">
                              <span className="block text-xs font-medium text-foreground-secondary">{index + 1}. {item.question}</span>
                              <span className="mt-1 block text-sm text-primary">{clarificationAnswers[index]}</span>
                            </button>
                          ))}
                        </div>
                        <div className="mt-4 flex justify-end gap-2 border-t border-border/50 pt-4">
                          <Button variant="ghost" onClick={cancelClarifications}>Cancel</Button>
                          <Button onClick={submitClarifications}>Submit answers</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Sending indicator */}
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
                      <div className="flex items-center gap-2 text-sm text-foreground-muted px-3 py-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span className="flex-1">{generationPhase?.label ?? "Starting generation"}</span>
                        {liveThinking && (
                          <button
                            type="button"
                            onClick={() => setShowLiveThinking((v) => !v)}
                            className="flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground-secondary transition-colors"
                          >
                            <ChevronRight
                              className={cn(
                                "h-3.5 w-3.5 transition-transform duration-200",
                                showLiveThinking && "rotate-90",
                              )}
                            />
                            {showLiveThinking ? "Hide reasoning" : "Show reasoning"}
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
                        <span className="min-w-0 flex-1 truncate text-foreground-secondary">{activeFile.path}</span>
                        <span className="text-foreground-muted">Ln {activeFile.line}, Col {activeFile.column}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-border bg-background-subtle p-2.5 sm:p-3">
            <div className="relative mx-auto max-w-3xl">
              {clarifyingQuestions.length > 0 ? (
                <p className="py-2 text-center text-xs text-foreground-muted">Complete or cancel the clarification above to continue chatting.</p>
              ) : (
                <>
                  {/* FLOATING MODEL & REASONING POPOVER */}
                  {showModelPopover && (
                    <div className="absolute bottom-full right-12 mb-3 z-30 w-80 overflow-hidden rounded-2xl border border-white/15 bg-[#1a1a1c] p-3 shadow-2xl backdrop-blur-xl">
                      {/* ROOT MENU (Model & Effort rows) */}
                      {activeSubMenu === 'root' && (
                        <div className="space-y-1">
                          <button
                            type="button"
                            onClick={() => setActiveSubMenu('models')}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5"
                          >
                            <span className="text-foreground-secondary">Model</span>
                            <div className="flex items-center gap-1 text-white">
                              <span>{selectedModel || 'Select model'}</span>
                              <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveSubMenu('effort')}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5"
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

                      {/* MODELS SUB-MENU */}
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

                          {/* Model Search Input */}
                          <div className="relative mb-2.5">
                            <input
                              type="text"
                              placeholder="Search models..."
                              value={modelSearchQuery}
                              onChange={(e) => setModelSearchQuery(e.target.value)}
                              className="h-9 w-full rounded-lg border border-white/20 bg-[#121214] px-3 pr-7 text-xs font-medium text-white placeholder:text-foreground-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                            />
                            {modelSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setModelSearchQuery('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-muted hover:text-white"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                            {filteredModels.length > 0 ? (
                              filteredModels.map((group) => (
                                <div key={group.provider} className="space-y-0.5">
                                  <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                                    {group.label}
                                  </div>
                                  {group.models.map((model) => {
                                    const key = `${group.provider}:${model}`;
                                    const isSelected = key === selectedModelKey;
                                    return (
                                      <button
                                        key={key}
                                        type="button"
                                        onClick={() => {
                                          setSelectedModelKey(key);
                                          setActiveSubMenu('root');
                                        }}
                                        className={cn(
                                          'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                                          isSelected
                                            ? 'bg-primary/15 font-medium text-primary'
                                            : 'text-foreground-secondary hover:bg-white/5 hover:text-white',
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

                      {/* EFFORT SUB-MENU */}
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
                          <div className="space-y-1">
                            {REASONING_LEVELS.filter(
                              (level) =>
                                level.value !== 'off' ||
                                REASONING_OFF_PROVIDERS.has(selectedProvider ?? ''),
                            ).map((level) => {
                              const isSelected = level.value === reasoningEffort;
                              return (
                                <button
                                  key={level.value}
                                  type="button"
                                  onClick={() => {
                                    setReasoningEffort(level.value);
                                    setActiveSubMenu('root');
                                  }}
                                  className={cn(
                                    'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                                    isSelected
                                      ? 'bg-primary/15 font-medium text-primary'
                                      : 'text-foreground-secondary hover:bg-white/5 hover:text-white',
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

                  {/* PROMPT CAPSULE CARD */}
                  <div className="rounded-2xl border border-white/10 bg-[#161618] p-3 shadow-2xl transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/40">
                    {/* Target element badge inside capsule */}
                    {selectedPreviewElement && (
                      <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
                        <Crosshair className="h-3.5 w-3.5 text-primary" />
                        <span className="text-foreground-secondary">
                          Editing <span className="font-mono font-medium text-foreground">{selectedPreviewElement.selector}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedPreviewElement(null)}
                          className="ml-auto rounded p-0.5 text-foreground-muted hover:text-white"
                          aria-label="Clear selected element"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Textarea */}
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={selectedPreviewElement ? `Describe the change for this ${selectedPreviewElement.tagName}…` : 'Describe what you want to build or change…'}
                      rows={2}
                      className="max-h-36 min-h-[44px] w-full resize-none border-none bg-transparent px-2 text-sm text-white shadow-none placeholder:text-foreground-muted outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                    />

                    {/* Footer Controls Bar */}
                    <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                      {/* Left side: Plus attachment trigger & file chips */}
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          multiple
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            if (files.length > 0) {
                              setAttachedFiles((prev) => [
                                ...prev,
                                ...files.map((f) => ({ name: f.name, file: f })),
                              ]);
                            }
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
                            key={idx}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white"
                          >
                            <Paperclip className="h-3 w-3 text-primary" />
                            <span className="max-w-[120px] truncate">{file.name}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="text-foreground-muted hover:text-white"
                              aria-label="Remove attachment"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Right side: Config trigger pill & Circular send button */}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowModelPopover((prev) => !prev);
                            setActiveSubMenu('root');
                          }}
                          className={cn(
                            'flex items-center rounded-full bg-transparent px-3 py-1.5 text-xs transition-all hover:bg-white/[0.08]',
                            showModelPopover && 'bg-white/[0.10] ring-1 ring-white/15',
                          )}
                        >
                          <span className="font-medium text-[#E5E5E5]">
                            {selectedModel || 'Select Model'}
                          </span>
                          <span className="ml-2.5 font-normal text-[#9A9A9A]">
                            {REASONING_LEVELS.find((r) => r.value === reasoningEffort)?.label ?? 'Auto'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isSending) {
                              handleStop();
                            } else {
                              void handleSend();
                            }
                          }}
                          disabled={isSending ? false : (!input.trim() || !selectedModel || !selectedProvider)}
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-full transition-all',
                            isSending
                              ? 'bg-red-500 text-white shadow-md'
                              : input.trim() && selectedModel && selectedProvider
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20'
                                : 'bg-white/10 text-white/30 cursor-not-allowed',
                          )}
                          aria-label={isSending ? "Stop agent" : "Send message"}
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

                </>
              )}
            </div>
          </div>
        </div>

        <div className="relative hidden min-w-0 flex-1 flex-col bg-background md:flex">
          <div className="flex items-center gap-3 border-b border-border bg-background-subtle px-4 py-2.5">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
              <TabsList className="h-8">
                <TabsTrigger value="preview" className="gap-1.5 text-xs">
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-1.5 text-xs">
                  <Code className="h-3.5 w-3.5" />
                  Code
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="inline-flex h-8 items-center rounded-md bg-[#1A1A1A] p-1">
              <button
                type="button"
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none',
                  isEditMode
                    ? 'bg-[#0A0A0A] text-[#ECECEC] shadow-sm'
                    : 'text-[#6B6B6B] hover:text-[#ECECEC]',
                )}
                onClick={() => {
                  setActiveTab('preview');
                  setIsEditMode((enabled) => !enabled);
                }}
                aria-pressed={isEditMode}
              >
                <Crosshair className="h-3.5 w-3.5" />
                <span>Edit</span>
              </button>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewKey((key) => key + 1)} aria-label="Refresh preview">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {activeTab === 'preview' && (
            <div className="relative flex flex-1 overflow-hidden bg-[#0A0A0A]">
              {sandbox.url ? (
                <>
                  {previewSlotRevisions.map((revision, slot) => revision === null ? null : (
                    <iframe
                      ref={(frame) => {
                        previewFramesRef.current[slot] = frame;
                      }}
                      key={`${slot}:${revision}`}
                      src={`${sandbox.url!}${sandbox.url!.includes('?') ? '&' : '?'}revision=${revision}`}
                      title={slot === visiblePreviewSlot ? 'Live app preview' : 'Loading app preview'}
                      className={cn(
                        'absolute inset-0 h-full w-full border-0 bg-[#0A0A0A]',
                        slot === visiblePreviewSlot ? 'z-10 visible' : 'z-0 invisible',
                      )}
                      allow="cross-origin-isolated"
                      onLoad={() => {
                        if (revision !== previewKey || slot === visiblePreviewSlotRef.current) return;
                        const nextSlot = slot as 0 | 1;
                        visiblePreviewSlotRef.current = nextSlot;
                        setVisiblePreviewSlot(nextSlot);
                        requestAnimationFrame(() => setPreviewEditMode(isEditMode));
                      }}
                    />
                  ))}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center px-6 text-center">
                  <div>
                    {sandbox.status === 'error' ? <AlertCircle className="mx-auto mb-3 h-7 w-7 text-error" /> : <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-primary" />}
                    <p className="text-sm font-medium text-foreground-secondary">{sandbox.error ?? 'Starting secure preview sandbox'}</p>
                    <p className="mt-1 text-xs text-foreground-muted">{sandbox.logs.at(-1) ?? 'Booting browser-based Node.js runtime…'}</p>
                  </div>
                </div>
              )}
              {isEditMode && !selectedPreviewElement && sandbox.url && (
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
          )}
          {activeTab === 'code' && (
            <div className="flex min-h-0 flex-1 bg-[#111]">
              <div className="w-44 shrink-0 overflow-y-auto border-r border-white/10 py-2">
                {displayedFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setActiveFile({ path: file.path, content: file.content, line: 1, column: 0 })}
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
                  {activeFile?.path ?? displayedFiles[0]?.path ?? 'No generated files'}
                </div>
                <pre className="min-h-full p-4 font-mono text-xs leading-5 text-[#d4d4d4]"><code>{activeFile?.content ?? displayedFiles[0]?.content ?? 'Describe the app you want to build.'}</code></pre>
                {isSending && smoothCursor.visible && (
                  <div
                    className="pointer-events-none absolute left-4 z-20 flex items-center"
                    style={{
                      transform: `translateY(${42 + Math.max(0, smoothCursor.pos.line - 1) * 20}px)`,
                      transition: 'transform 0.1s linear',
                    }}
                  >
                    <span className="h-4 w-0.5 animate-pulse bg-primary" />
                    <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">AI</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile: preview toggle */}
        <div className="fixed bottom-4 right-4 z-30 md:hidden">
          <Button
            size="sm"
            className="shadow-lg"
            onClick={() => setActiveTab(activeTab === 'preview' ? 'code' : 'preview')}
          >
            {activeTab === 'preview' ? (
              <>
                <Code className="mr-1.5 h-3.5 w-3.5" /> View Code
              </>
            ) : (
              <>
                <Eye className="mr-1.5 h-3.5 w-3.5" /> View Preview
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
