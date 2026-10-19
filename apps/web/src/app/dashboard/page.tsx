'use client';

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUp,
  Copy,
  ExternalLink,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Search,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpc } from '@/lib/trpc/client';
import { isTypingTarget } from '@/lib/keyboard';
import { motion } from 'framer-motion';
import { cn } from '@app-builder/ui/utils';
import { templateGuides, templates } from '@/data/templates';
import { DotGrid } from './dot-grid';
import { TemplatePicker } from './template-picker';

// Matches the `description` limit on projects.create, where the prompt is stored.
const PROMPT_LIMIT = 500;

// Shortcuts to catalog templates; each inserts that template's brief.
const promptStarters = [
  { label: 'Dashboard', templateId: 'tpl-admin-panel' },
  { label: 'Blog', templateId: 'tpl-blog' },
  { label: 'SaaS landing', templateId: 'tpl-landing-page' },
  { label: 'Todo app', templateId: 'tpl-task-tracker' },
];

// Cycled through the empty prompt's placeholder; module-level so the
// typewriter effect's dependency stays stable.
const examplePrompts = [
  'A habit tracker with streaks, reminders and a weekly progress chart',
  'A booking page for a hair salon with services, staff and time slots',
  'An internal tool to approve expense reports with receipts and comments',
  'A recipe app where I can save meals and generate a shopping list',
];

/** The starting prompt for a template, falling back to its description. */
function templateBrief(templateId: string): string {
  const template = templates.find((item) => item.id === templateId);
  return templateGuides[templateId]?.brief ?? template?.description ?? '';
}

function relativeTime(date: Date) {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
/** Name a prompt-created project after the start of its prompt; it can be renamed later. */
function nameFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? '';
  const words = firstLine
    .replace(/^(an?|the)\s+/i, '')
    .split(/\s+/)
    .slice(0, 6)
    .join(' ');
  const name = words.replace(/[.,;:!?]+$/, '').slice(0, 60);
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Untitled Project';
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/**
 * Type each phrase out, hold it, delete it, then move to the next, for an
 * empty prompt's placeholder. Returns `fallback` while inactive or when the
 * viewer prefers reduced motion.
 */
function useTypewriter(phrases: readonly string[], active: boolean, fallback: string): string {
  const [text, setText] = useState('');
  const reducedMotion = useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );

  useEffect(() => {
    if (!active || reducedMotion || phrases.length === 0) return;
    let phrase = 0;
    let length = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const current = phrases[phrase] ?? '';
      if (!deleting && length < current.length) {
        length += 1;
        timer = setTimeout(step, 55 + Math.random() * 45);
      } else if (!deleting) {
        deleting = true;
        timer = setTimeout(step, 2200);
      } else if (length > 0) {
        length -= 1;
        timer = setTimeout(step, 18);
      } else {
        deleting = false;
        phrase = (phrase + 1) % phrases.length;
        timer = setTimeout(step, 500);
      }
      setText(current.slice(0, length));
    };
    timer = setTimeout(step, 600);
    return () => {
      clearTimeout(timer);
      setText('');
    };
  }, [phrases, active, reducedMotion]);

  return active && !reducedMotion && text ? text : fallback;
}
const statusVariant = { draft: 'secondary', published: 'success', archived: 'warning' } as const;
type DbStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
const statusMap: Record<DbStatus, 'draft' | 'published' | 'archived'> = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

interface ProjectSummary {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  createdAt: Date;
  lastEdited: Date;
  thumbnailUrl: string | null;
  liveUrl: string | null;
  /** Never built: no generated files and nothing to preview. */
  isEmpty: boolean;
}

/** A project is empty until a build writes files or gives it something to preview. */
function isEmptyProject(project: {
  fileCount: number;
  thumbnailUrl: string | null;
  liveUrl: string | null;
}): boolean {
  return project.fileCount === 0 && !project.thumbnailUrl && !project.liveUrl;
}

/** Empty projects open the editor with its prompt focused, ready for the first build. */
function projectHref(project: ProjectSummary): string {
  return project.isEmpty ? `/project/${project.id}?focus=prompt` : `/project/${project.id}`;
}

function activityLabel(project: ProjectSummary): string {
  return project.isEmpty
    ? `Created ${relativeTime(project.createdAt)}`
    : `Edited ${relativeTime(project.lastEdited)}`;
}

interface ProjectActions {
  onRename: (project: ProjectSummary) => void;
  onDuplicate: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
}

/**
 * Screenshot, else the live site in a scaled-down, inert iframe, else the
 * interactive dot grid. Every variant ignores the pointer so clicks reach
 * the card's stretched link underneath.
 */
function ProjectThumbnail({ project, className }: { project: ProjectSummary; className?: string }) {
  if (project.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- thumbnails are user-app screenshots on arbitrary hosts
      <img
        src={project.thumbnailUrl}
        alt=""
        className={cn('pointer-events-none object-cover object-top', className)}
        loading="lazy"
      />
    );
  }
  if (project.liveUrl) {
    return (
      <div
        aria-hidden="true"
        className={cn('pointer-events-none relative overflow-hidden bg-background', className)}
      >
        {/* Rendered at 4x and scaled down so the site lays out at desktop width. */}
        <iframe
          src={project.liveUrl}
          title=""
          tabIndex={-1}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
          className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-[0.25] border-0"
        />
      </div>
    );
  }
  return <DotGrid className={className} />;
}

function ProjectMenu({
  project,
  actions,
  className,
}: {
  project: ProjectSummary;
  actions: ProjectActions;
  className?: string;
}) {
  const router = useRouter();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${project.name}`}
          className={cn(
            'grid h-7 w-7 place-items-center rounded-control-inner text-foreground-secondary transition-colors hover:bg-background-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => router.push(`/project/${project.id}`)}>
          <SquareArrowOutUpRight />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onRename(project)}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onDuplicate(project)}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        {project.liveUrl ? (
          <DropdownMenuItem asChild>
            <a href={project.liveUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Visit live site
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => actions.onDelete(project)}
          className="text-error focus:bg-error/10 focus:text-error"
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LiveLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-10 truncate text-xs text-foreground-muted transition-colors hover:text-foreground"
    >
      {hostOf(url)}
    </a>
  );
}

/**
 * The card's link is a stretched overlay rather than a wrapper, so the menu
 * and live-site link stay valid, independently focusable siblings.
 */
function ProjectCard({ project, actions }: { project: ProjectSummary; actions: ProjectActions }) {
  return (
    <div className="group relative min-w-0 overflow-hidden rounded-card border border-border bg-background-subtle transition-colors hover:border-border-strong has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-border-focus/40">
      <Link
        href={projectHref(project)}
        data-card-link
        aria-label={project.isEmpty ? `Start building ${project.name}` : `Open ${project.name}`}
        className="absolute inset-0 focus-visible:outline-none"
      />
      <ProjectThumbnail
        project={project}
        className="aspect-[16/10] w-full border-b border-border"
      />
      <ProjectMenu
        project={project}
        actions={actions}
        className="absolute right-2.5 top-2.5 z-10 border border-border bg-background-subtle opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
      <div className="pointer-events-none relative px-4 py-3.5 [&_a]:pointer-events-auto">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium tracking-[-0.01em]">{project.name}</h3>
          {project.isEmpty ? null : (
            <Badge variant={statusVariant[project.status]} className="shrink-0 text-[10px]">
              {project.status}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted">
          <span className="shrink-0">{activityLabel(project)}</span>
          {project.liveUrl ? (
            <>
              <span aria-hidden="true">·</span>
              <LiveLink url={project.liveUrl} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Render the authenticated project list, the prompt-first project creator, and card actions. */
function DashboardContent() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  // Debounce the keystroke stream: each change creates a new infinite query
  // (search is part of the key), and firing one per character spams the
  // server with near-duplicate page fetches.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Paginated newest-first, filtered server-side so search matches every
  // project, not just the pages loaded so far.
  const projectsQuery = trpc.projects.list.useInfiniteQuery(
    { search: debouncedSearch || undefined },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const orgsQuery = trpc.organizations.list.useQuery();

  const createMutation = trpc.projects.create.useMutation();
  const renameMutation = trpc.projects.update.useMutation({
    onSuccess: () => utils.projects.list.invalidate(),
  });
  const duplicateMutation = trpc.projects.duplicate.useMutation({
    onSuccess: () => utils.projects.list.invalidate(),
  });
  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => utils.projects.list.invalidate(),
  });

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState('');
  const placeholder = useTypewriter(
    examplePrompts,
    prompt === '',
    'Describe what you want to build…',
  );
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // "/" opens the template picker unless something else has the keyboard.
  const otherDialogOpen = renaming !== null || deleting !== null;
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented || otherDialogOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      setPickerOpen(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [otherDialogOpen]);

  /** Put a brief in the prompt and leave the caret after it; never submits. */
  function insertBrief(brief: string) {
    setPrompt(brief);
    setCreateError(null);
    // Wait for the new value to render before placing the caret.
    requestAnimationFrame(() => {
      const textarea = promptRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.scrollTop = textarea.scrollHeight;
    });
  }

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/auth/signin');
  }, [authStatus, router]);
  const searchParams = useSearchParams();

  // The sidebar's "New project" lands here: the prompt box is the creator.
  useEffect(() => {
    // The textarea mounts only once the session resolves.
    if (searchParams.get('new') === 'true' && promptRef.current) {
      promptRef.current.focus();
      router.replace('/dashboard');
    }
  }, [searchParams, router, authStatus]);

  useEffect(() => {
    const handleOpenNew = () => promptRef.current?.focus();
    window.addEventListener('open-new-project', handleOpenNew);
    return () => window.removeEventListener('open-new-project', handleOpenNew);
  }, []);

  const projects = useMemo<ProjectSummary[]>(() => {
    const raw = projectsQuery.data?.pages.flatMap((page) => page.projects) ?? [];
    return raw.map((p) => {
      const live = p.deployments[0];
      const liveUrl = live?.customDomain ? `https://${live.customDomain}` : (live?.url ?? null);
      return {
        id: p.id,
        name: p.name,
        status: statusMap[p.status as DbStatus] ?? 'draft',
        createdAt: new Date(p.createdAt),
        lastEdited: new Date(p.updatedAt),
        thumbnailUrl: p.thumbnailUrl,
        liveUrl,
        isEmpty: isEmptyProject({
          fileCount: p._count.files,
          thumbnailUrl: p.thumbnailUrl,
          liveUrl,
        }),
      };
    });
  }, [projectsQuery.data]);
  // Fetch the next (older) page into the accumulated list.
  const loadMoreProjects = () => {
    void projectsQuery.fetchNextPage();
  };

  const actions: ProjectActions = {
    onRename: (project) => {
      setRenameValue(project.name);
      setRenaming(project);
    },
    onDuplicate: (project) => duplicateMutation.mutate({ id: project.id }),
    onDelete: setDeleting,
  };

  /**
   * Create a project in the first available workspace with the prompt as its
   * brief, then open the editor, which seeds the prompt from the brief.
   */
  async function createProject(event?: FormEvent) {
    event?.preventDefault();
    const brief = prompt.trim();
    if (!brief || isCreating) return;
    const orgId = orgsQuery.data?.[0]?.id;
    if (!orgId) {
      // `organizations.list` only feeds this lookup, so a failure here is
      // reported under the prompt instead of blocking the whole dashboard.
      setCreateError(
        orgsQuery.isError
          ? 'Could not load your workspaces. Check your connection and try again.'
          : 'No workspace found. Create or join an organization first.',
      );
      if (orgsQuery.isError) void orgsQuery.refetch();
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const project = await createMutation.mutateAsync({
        name: nameFromPrompt(brief),
        description: brief,
        organizationId: orgId,
      });
      router.push(`/project/${project.id}`);
    } catch (error) {
      setCreateError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not create the project. Please try again.',
      );
      setIsCreating(false);
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void createProject();
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const name = renameValue.trim();
    if (!renaming || !name) return;
    try {
      if (name !== renaming.name) await renameMutation.mutateAsync({ id: renaming.id, name });
      setRenaming(null);
    } catch {
      // The global mutation-cache toast reports it; keep the dialog open.
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync({ id: deleting.id });
      setDeleting(null);
    } catch {
      // The global mutation-cache toast reports it; keep the dialog open.
    }
  }

  if (authStatus === 'loading')
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  if (!session) return null;

  // Initial-load failures render after the auth guards, and after every hook
  // has run. Both queries fire while the session is still loading, so
  // rendering these first would surface UNAUTHORIZED as a dead-end "Failed to
  // load" screen for anonymous visitors - with a Retry button that refetches
  // into the same failure - racing the redirect to /auth/signin.
  // `&& !data` keeps a working page visible: react-query retains `data` when
  // a background refetch fails, and the global query-cache onError toast
  // (lib/trpc/react.tsx) already surfaces that transient failure.
  if (projectsQuery.isError && !projectsQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-auto max-w-md p-8 text-center">
          <h1 className="mb-4 text-2xl font-bold text-foreground">Failed to load projects</h1>
          <p className="mb-6 text-foreground-secondary">
            {projectsQuery.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => projectsQuery.refetch()}
            className="rounded-control bg-primary px-4 py-2 text-primary-foreground hover:bg-primary-hover"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full min-w-0 bg-background">
      <main className="mx-auto w-full min-w-0 max-w-[1200px] px-5 py-8 sm:px-8 lg:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="shrink-0 text-2xl font-semibold tracking-[-0.03em]">Projects</h1>
          <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
            <div className="relative min-w-0 flex-1 sm:max-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                placeholder="Search projects"
                aria-label="Search projects"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
          </div>
        </header>

        <section className="mt-6">
          <form
            onSubmit={createProject}
            className="rounded-card border border-border bg-background-subtle transition-colors focus-within:border-border-strong hover:border-border-strong"
          >
            <textarea
              ref={promptRef}
              aria-label="Describe what you want to build"
              value={prompt}
              maxLength={PROMPT_LIMIT}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (createError) setCreateError(null);
              }}
              onKeyDown={handlePromptKeyDown}
              placeholder={placeholder}
              rows={3}
              className="block min-h-24 w-full resize-none bg-transparent px-4 pt-4 text-sm leading-6 text-foreground placeholder:text-foreground-muted/60 focus:outline-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-end gap-3 px-3 pb-3">
              {prompt.length > PROMPT_LIMIT * 0.8 ? (
                <span className="text-xs tabular-nums text-foreground-muted">
                  {prompt.length}/{PROMPT_LIMIT}
                </span>
              ) : null}
              <Button
                type="submit"
                size="icon-sm"
                aria-label={isCreating ? 'Creating project' : 'Create project'}
                disabled={!prompt.trim() || isCreating}
                // Dim only while there is nothing to send, not while creating.
                className={cn('shrink-0', isCreating && 'disabled:opacity-100')}
              >
                {isCreating ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </form>
          {createError ? (
            <p role="alert" className="mt-2 text-sm text-error">
              {createError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {promptStarters.map((starter) => (
              <button
                key={starter.label}
                type="button"
                onClick={() => insertBrief(templateBrief(starter.templateId))}
                className="rounded-full border border-border px-3 py-1 text-xs text-foreground-secondary transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
              >
                {starter.label}
              </button>
            ))}
            <button
              type="button"
              aria-haspopup="dialog"
              aria-keyshortcuts="/"
              onClick={() => setPickerOpen(true)}
              className="rounded-full px-2 py-1 text-xs text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
            >
              Browse all →
            </button>
          </div>
          <TemplatePicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onPick={(template) => insertBrief(templateBrief(template.id))}
          />
        </section>

        <section className="mt-12">
          {projectsQuery.isLoading ? (
            <div className="flex justify-center py-20">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-card border border-dashed border-border py-16 text-center">
              <FolderKanban className="mx-auto h-6 w-6 text-foreground-muted" />
              {debouncedSearch ? (
                <>
                  <h2 className="mt-4 text-sm font-medium">No matching projects</h2>
                  <p className="mt-1 text-sm text-foreground-muted">Try another search.</p>
                </>
              ) : (
                <p className="mt-4 text-sm text-foreground-muted">
                  Your projects will show up here.
                </p>
              )}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
            >
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} actions={actions} />
              ))}
            </motion.div>
          )}
          {projectsQuery.hasNextPage && !projectsQuery.isFetchingNextPage && (
            <div className="mt-8 flex justify-center">
              <Button variant="ghost" size="sm" onClick={loadMoreProjects}>
                Load more
              </Button>
            </div>
          )}
          {projectsQuery.isFetchingNextPage && (
            <div className="mt-8 flex justify-center text-sm text-foreground-muted">Loading…</div>
          )}
        </section>
      </main>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <form onSubmit={submitRename}>
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
            </DialogHeader>
            <div className="py-5">
              <Input
                autoFocus
                aria-label="Project name"
                value={renameValue}
                maxLength={100}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!renameValue.trim() || renameMutation.isPending}>
                {renameMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the project, its files and its app database. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-5">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-background">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
