'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { VersionTimeline } from '@/components/version-timeline';
import type { VersionTimelineEntry } from '@/components/version-timeline';
import { trpc } from '@/lib/trpc/client';
import { getPreviewCursorTarget, useSmoothCursor } from '@/lib/use-smooth-cursor';
import { usePreviewRuntime } from '@/lib/use-preview-runtime';
import { useGeneration } from '@/lib/use-generation';
import { ChatPanel } from '@/components/project/chat-panel';
import {
  PromptBar,
  PROVIDER_LABELS,
  REASONING_OFF_PROVIDERS,
} from '@/components/project/prompt-bar';
import { PreviewPane } from '@/components/project/preview-pane';
import { CodePane } from '@/components/project/code-pane';
import type { SelectedPreviewElement } from '@/components/project/types';
import { ArrowLeft, Settings, Rocket, Code, Eye, RefreshCw, Crosshair } from 'lucide-react';

const LEFT_PANEL_MIN = 20;
const LEFT_PANEL_MAX = 75;
const LEFT_PANEL_DEFAULT = 38;

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
  const [activeTab, setActiveTab] = useState('preview');
  const [reasoningEffort, setReasoningEffort] = useState('auto');
  const [isRestoring, setIsRestoring] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedPreviewElement, setSelectedPreviewElement] =
    useState<SelectedPreviewElement | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const totalWidth = window.innerWidth;
      if (totalWidth <= 0) return;
      const newWidthPercent = (e.clientX / totalWidth) * 100;
      const clamped = Math.min(Math.max(newWidthPercent, LEFT_PANEL_MIN), LEFT_PANEL_MAX);
      setLeftPanelWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const onResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 2;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setLeftPanelWidth((width) => Math.max(LEFT_PANEL_MIN, width - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setLeftPanelWidth((width) => Math.min(LEFT_PANEL_MAX, width + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setLeftPanelWidth(LEFT_PANEL_MIN);
    } else if (event.key === 'End') {
      event.preventDefault();
      setLeftPanelWidth(LEFT_PANEL_MAX);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      setLeftPanelWidth(LEFT_PANEL_DEFAULT);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'e' && event.key !== 'E') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setActiveTab('preview');
      setIsEditMode((enabled) => !enabled);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const initialFilesMemo = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const preview = usePreviewRuntime({
    projectId,
    initialFiles: initialFilesMemo,
    enabled: status === 'authenticated' && filesQuery.isSuccess,
  });

  const selectedProvider = selectedModelKey.split(':', 1)[0] || undefined;
  const selectedModel = selectedProvider ? selectedModelKey.slice(selectedProvider.length + 1) : '';

  useEffect(() => {
    if (reasoningEffort === 'off' && !REASONING_OFF_PROVIDERS.has(selectedProvider ?? '')) {
      setReasoningEffort('auto');
    }
  }, [reasoningEffort, selectedProvider]);

  const generation = useGeneration({
    projectId,
    selectedModel,
    selectedProvider,
    reasoningEffort,
    editTarget: selectedPreviewElement,
    preview,
    history: historyQuery.data,
    onHistoryRefetch: () => historyQuery.refetch(),
    onVersionsRefetch: () => versionsQuery.refetch(),
    onFilesRefetch: () => filesQuery.refetch(),
    onClearEditTarget: () => setSelectedPreviewElement(null),
    onClearInput: () => setInput(''),
    onRestoreInput: (text) => setInput(text),
  });

  const handleQuickEdit = useCallback(
    (prompt: string, element: SelectedPreviewElement) => {
      if (generation.isSending) return;
      // Keep the element highlighted in the preview while the edit runs, and
      // pass it as an explicit override so the request cannot miss it even if
      // the send fires before the next render commits the selection state.
      setSelectedPreviewElement(element);
      requestAnimationFrame(() => void generation.send(prompt, undefined, element));
    },
    [generation],
  );

  const smoothCursor = useSmoothCursor(
    generation.activeFile
      ? { line: generation.activeFile.line, column: generation.activeFile.column }
      : null,
  );
  const previewCursorTarget = useMemo(
    () =>
      generation.activeFile?.path.toLowerCase().endsWith('.html')
        ? getPreviewCursorTarget(generation.activeFile.content)
        : null,
    [generation.activeFile],
  );

  useEffect(() => {
    if (!projectQuery.data) return;
    setProjectName(projectQuery.data.name);
  }, [projectQuery.data]);

  const seenProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (seenProjectIdRef.current === projectId) return;
    seenProjectIdRef.current = projectId;
    setInput('');
    setSelectedPreviewElement(null);
    setIsEditMode(false);
  }, [projectId]);

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

  const handleRestoreVersion = useCallback(
    async (versionNumber: number) => {
      setIsRestoring(true);
      try {
        const restored = await restoreMutation.mutateAsync({ projectId, versionNumber });
        await preview.replaceFiles(preview.filesList, restored.files);
        const primaryRestored =
          restored.files.find((f) => f.path === 'index.html') ??
          restored.files.find((f) => f.path.endsWith('.html')) ??
          restored.files[0];
        if (primaryRestored) {
          generation.setActiveFile({
            path: primaryRestored.path,
            content: primaryRestored.content,
            line: 1,
            column: 0,
          });
        }
        generation.setCurrentVersion(restored.versionNumber);
        await Promise.all([versionsQuery.refetch(), filesQuery.refetch()]);
      } finally {
        setIsRestoring(false);
      }
    },
    [filesQuery, generation, preview, projectId, restoreMutation, versionsQuery],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [generation.localMessages, generation.isSending]);

  useEffect(() => {
    if (projectQuery.error?.data?.code === 'NOT_FOUND') {
      router.push('/dashboard');
    }
  }, [projectQuery.error, router]);

  const versionTimelineEntries = useMemo<VersionTimelineEntry[]>(
    () =>
      (versionsQuery.data ?? []).map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        createdAt: new Date(version.createdAt),
        fileCount: Object.keys(version.manifest as Record<string, string>).length,
        isRestore: false,
      })),
    [versionsQuery.data],
  );

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="default"
                  className="h-9 cursor-not-allowed gap-2 rounded-lg px-4 text-xs font-semibold opacity-45 shadow-sm sm:text-sm"
                  aria-disabled="true"
                  onClick={(event) => event.preventDefault()}
                >
                  <Rocket className="h-4 w-4" />
                  <span className="hidden sm:inline">Deploy</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Vercel is not connected.</TooltipContent>
            </Tooltip>
          </TooltipProvider>

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

      <div className="border-b border-border bg-background-subtle">
        <VersionTimeline
          versions={versionTimelineEntries}
          currentVersion={generation.currentVersion}
          onSelectVersion={generation.setCurrentVersion}
          onRestoreVersion={handleRestoreVersion}
          isLoading={versionsQuery.isLoading || isRestoring}
        />
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {isResizing && (
          <div
            className="fixed inset-0 z-50 cursor-col-resize select-none"
            onMouseUp={() => setIsResizing(false)}
          />
        )}

        <div
          className="flex w-full flex-col border-r border-border bg-background transition-[width] duration-75"
          style={{ width: `${leftPanelWidth}%` }}
        >
          <ChatPanel
            messages={generation.localMessages}
            historyLoading={historyQuery.isLoading}
            historyErrorMessage={historyQuery.error?.message}
            isSending={generation.isSending}
            selectedModel={selectedModel}
            generationPhase={generation.generationPhase}
            liveThinking={generation.liveThinking}
            liveStepTitle={generation.liveStepTitle}
            agentLiveMessage={generation.agentLiveMessage}
            activeFile={generation.activeFile}
            clarifyingQuestions={generation.clarifyingQuestions}
            clarificationAnswers={generation.clarificationAnswers}
            clarificationStep={generation.clarificationStep}
            customClarificationAnswer={generation.customClarificationAnswer}
            isCustomClarification={generation.isCustomClarification}
            isReviewingClarifications={generation.isReviewingClarifications}
            onCustomClarificationAnswerChange={generation.setCustomClarificationAnswer}
            onCustomClarificationToggle={generation.setIsCustomClarification}
            onClarificationStepChange={generation.setClarificationStep}
            onReviewingChange={generation.setIsReviewingClarifications}
            onAnswerClarification={generation.answerClarification}
            onCancelClarifications={generation.cancelClarifications}
            onSubmitClarifications={generation.submitClarifications}
            activeDesignDirections={generation.activeDesignDirections}
            onDirectionResponse={(response) => generation.send(undefined, response)}
            onClearDesignDirections={() => generation.setActiveDesignDirections(null)}
            messagesEndRef={messagesEndRef}
            footer={
              <PromptBar
                input={input}
                onInputChange={setInput}
                inputRef={inputRef}
                isSending={generation.isSending}
                selectedModelKey={selectedModelKey}
                selectedModel={selectedModel}
                selectedProvider={selectedProvider}
                onSelectModelKey={setSelectedModelKey}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={setReasoningEffort}
                availableModels={availableModels}
                selectedPreviewElement={selectedPreviewElement}
                onClearSelectedElement={() => setSelectedPreviewElement(null)}
                clarifyingLocked={generation.clarifyingQuestions.length > 0}
                onSend={(message, attachments) =>
                  void generation.send(message, undefined, undefined, attachments)
                }
                onStop={generation.stop}
              />
            }
          />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(leftPanelWidth)}
          aria-valuemin={LEFT_PANEL_MIN}
          aria-valuemax={LEFT_PANEL_MAX}
          aria-label="Resize chat and preview panels"
          tabIndex={0}
          onMouseDown={startResizing}
          onDoubleClick={() => setLeftPanelWidth(LEFT_PANEL_DEFAULT)}
          onKeyDown={onResizeKeyDown}
          className={cn(
            'group relative hidden w-1.5 shrink-0 cursor-col-resize select-none bg-border transition-colors hover:bg-primary/50 md:block',
            isResizing && 'bg-primary',
          )}
          title="Drag to resize panels • Double-click to reset"
        >
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded bg-[#242424] p-1 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="h-1.5 w-1.5 rounded-full bg-foreground-muted" />
            <div className="h-1.5 w-1.5 rounded-full bg-foreground-muted" />
            <div className="h-1.5 w-1.5 rounded-full bg-foreground-muted" />
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => preview.refreshPreview()}
              aria-label="Refresh preview"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {activeTab === 'preview' && (
            <PreviewPane
              url={preview.url}
              status={preview.status}
              logs={preview.logs}
              error={preview.error}
              engine={preview.engine}
              disclosure={preview.disclosure}
              previewKey={preview.previewKey}
              isEditMode={isEditMode}
              isSending={generation.isSending}
              previewCursorTarget={previewCursorTarget}
              selectedPreviewElement={selectedPreviewElement}
              onSelectedElementChange={setSelectedPreviewElement}
              onElementSelected={() => requestAnimationFrame(() => inputRef.current?.focus())}
              onQuickEdit={handleQuickEdit}
              onRetry={preview.retry}
            />
          )}
          {activeTab === 'code' && (
            <CodePane
              files={preview.filesList}
              activeFile={generation.activeFile}
              isSending={generation.isSending}
              onSelectFile={(file) =>
                generation.setActiveFile({
                  path: file.path,
                  content: file.content,
                  line: 1,
                  column: 0,
                })
              }
              cursor={smoothCursor}
            />
          )}
        </div>

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
