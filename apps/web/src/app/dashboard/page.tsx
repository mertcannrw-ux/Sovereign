'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  Clock3,
  FolderKanban,
  Grid2X2,
  List,
  Plus,
  Search,
  Sparkles,
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
import { trpc } from '@/lib/trpc/client';

// Accent color palette for project cards
const ACCENTS = [
  '#B8FF5A',
  '#8BC7FF',
  '#D6A7FF',
  '#FFBF7A',
  '#FF8A8A',
  '#8AFFB8',
  '#FFD700',
  '#FF8AD6',
];
function accentFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return ACCENTS[Math.abs(hash) % ACCENTS.length] ?? ACCENTS[0]!;
}
function relativeTime(date: Date) {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
const statusVariant = { draft: 'secondary', published: 'success', archived: 'warning' } as const;
type DbStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
const statusMap: Record<DbStatus, 'draft' | 'published' | 'archived'> = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};
function DashboardContent() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
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
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/auth/signin');
  }, [authStatus, router]);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setShowNew(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const handleOpenNew = () => setShowNew(true);
    window.addEventListener('open-new-project', handleOpenNew);
    return () => window.removeEventListener('open-new-project', handleOpenNew);
  }, []);

  const projects = useMemo(() => {
    const raw = projectsQuery.data?.pages.flatMap((page) => page.projects) ?? [];
    return raw.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      status: statusMap[p.status as DbStatus] ?? 'draft',
      lastEdited: new Date(p.updatedAt),
      accent: accentFromName(p.name),
    }));
  }, [projectsQuery.data]);
  // Fetch the next (older) page into the accumulated list.
  const loadMoreProjects = () => {
    void projectsQuery.fetchNextPage();
  };

  async function createProject() {
    if (!name.trim() || isCreating) return;
    const orgId = orgsQuery.data?.[0]?.id;
    if (!orgId) {
      setCreateError('No workspace found. Create or join an organization first.');
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const project = await createMutation.mutateAsync({
        name: name.trim(),
        description: prompt.trim() || undefined,
        organizationId: orgId,
      });
      setShowNew(false);
      setName('');
      setPrompt('');
      router.push(`/project/${project.id}`);
    } catch (error) {
      // Keep the dialog open and explain why, instead of closing silently.
      setCreateError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not create the project. Please try again.',
      );
    } finally {
      setIsCreating(false);
    }
  }

  if (authStatus === 'loading')
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  if (!session) return null;

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-8 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:py-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Workspace
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Projects</h1>
            <p className="mt-2 text-sm text-foreground-muted">
              Welcome back, {session.user?.name?.split(' ')[0] ?? 'builder'}. Pick up where you left
              off.
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => setShowNew(true)}
            disabled={isCreating || orgsQuery.isLoading}
          >
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Button>
        </div>
      </header>

      <Dialog
        open={showNew}
        onOpenChange={(open) => {
          setShowNew(open);
          if (!open && searchParams.get('new') === 'true') {
            router.replace('/dashboard');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new project</DialogTitle>
            <DialogDescription>
              Give it a clear name and describe the outcome. You can refine everything later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project name</label>
              <Input
                autoFocus
                placeholder="Acme customer portal"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">What are you building?</label>
              <textarea
                className="min-h-32 w-full resize-none rounded-lg border border-border bg-background-muted px-3.5 py-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-border-focus/40"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A task manager with drag-and-drop kanban boards"
              />
            </div>
          </div>
          {createError ? (
            <p role="alert" className="mt-4 text-sm text-error">
              {createError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={createProject} disabled={!name.trim() || isCreating}>
              {isCreating ? 'Creating\u2026' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8">
        <section className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            [
              'Active projects',
              String(projects.filter((p) => p.status !== 'archived').length),
              'Across your workspace',
            ],
            [
              'Published',
              String(projects.filter((p) => p.status === 'published').length),
              'Live applications',
            ],
            [
              'Latest activity',
              projects[0] ? relativeTime(projects[0].lastEdited) : '\u2014',
              'Since your last edit',
            ],
          ].map(([label, value, detail]) => (
            <div key={label} className="rounded-xl border border-border bg-background-subtle p-5">
              <p className="text-xs text-foreground-muted">{label}</p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
              <p className="mt-1 text-xs text-foreground-muted">{detail}</p>
            </div>
          ))}
        </section>
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <Input
              placeholder="Search projects"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background-subtle p-1">
            <button
              aria-label="Grid view"
              onClick={() => setView('grid')}
              className={`rounded-md p-2 ${view === 'grid' ? 'bg-background-muted text-foreground' : 'text-foreground-muted'}`}
            >
              <Grid2X2 className="h-4 w-4" />
            </button>
            <button
              aria-label="List view"
              onClick={() => setView('list')}
              className={`rounded-md p-2 ${view === 'list' ? 'bg-background-muted text-foreground' : 'text-foreground-muted'}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {projectsQuery.isLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-20 text-center">
            <FolderKanban className="mx-auto h-8 w-8 text-foreground-muted" />
            <h2 className="mt-5 text-lg font-semibold">
              {projects.length === 0 ? 'No projects yet' : 'No matching projects'}
            </h2>
            <p className="mt-2 text-sm text-foreground-muted">
              {projects.length === 0
                ? 'Create your first project to get started.'
                : 'Try another search or create something new.'}
            </p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="group overflow-hidden rounded-2xl border border-border bg-background-subtle transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_24px_60px_rgba(0,0,0,.3)]"
              >
                <div className="relative aspect-[16/9] overflow-hidden bg-background-subtle">
                  <div className="absolute inset-5 rounded-xl border border-white/[0.08] bg-background-subtle p-4">
                    <div className="flex gap-1.5">
                      <i className="h-1.5 w-1.5 rounded-full bg-white/15" />
                      <i className="h-1.5 w-1.5 rounded-full bg-white/15" />
                      <i className="h-1.5 w-1.5 rounded-full bg-white/15" />
                    </div>
                    <div
                      className="mt-5 h-2 w-1/3 rounded-full"
                      style={{ background: project.accent }}
                    />
                    <div className="mt-3 h-2 w-3/4 rounded-full bg-white/10" />
                    <div className="mt-2 h-2 w-1/2 rounded-full bg-white/10" />
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold tracking-[-0.01em]">
                      {project.name}
                    </h3>
                    <Badge variant={statusVariant[project.status]} className="shrink-0 text-[10px]">
                      {project.status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-foreground-muted">
                    {project.description}
                  </p>
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] text-foreground-muted">
                    <Clock3 className="h-3 w-3" />
                    {relativeTime(project.lastEdited)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="flex items-center gap-4 border-b border-border bg-background-subtle px-5 py-4 last:border-0 hover:bg-background-muted"
              >
                <span className="h-9 w-1 rounded-full" style={{ background: project.accent }} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{project.name}</p>
                  <p className="truncate text-xs text-foreground-muted">{project.description}</p>
                </div>
                <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
                <span className="hidden text-xs text-foreground-muted sm:block">
                  {relativeTime(project.lastEdited)}
                </span>
              </Link>
            ))}
          </div>
        )}
        {projectsQuery.hasNextPage && !projectsQuery.isFetchingNextPage && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={loadMoreProjects}
              className="rounded-lg border border-border bg-background-subtle px-4 py-2 text-sm text-foreground-secondary transition-colors hover:border-border-strong hover:text-foreground"
            >
              Load more
            </button>
          </div>
        )}
        {projectsQuery.isFetchingNextPage && (
          <div className="mt-8 flex justify-center text-sm text-foreground-muted">Loading…</div>
        )}

        <Link
          href="/dashboard/templates"
          className="mt-10 flex flex-col gap-5 rounded-2xl border border-border bg-background-subtle p-6 transition-colors hover:border-border-strong sm:flex-row sm:items-center"
        >
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">Start from a brief</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Pick a pattern, name the project, and open it with the prompt ready.
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-foreground-muted" />
        </Link>
      </main>
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
