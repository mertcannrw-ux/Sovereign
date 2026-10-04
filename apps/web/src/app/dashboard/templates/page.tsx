'use client';

import { Suspense, useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Cloud,
  FileText,
  GraduationCap,
  Grid2X2,
  Heart,
  LayoutGrid,
  LayoutTemplate,
  List,
  Search,
  ShoppingCart,
  Wrench,
  X,
} from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc/client';
import {
  TEMPLATE_BRIEF_LIMIT,
  matchesTemplate,
  sortTemplates,
  templateCategories,
  templateGuides,
  templates,
  type TemplateCategory,
  type TemplateSort,
} from '@/data/templates';
import type { Template } from '@app-builder/shared';
import { TemplateSketch } from './template-sketch';

const PROJECT_NAME_LIMIT = 100;

/**
 * Per-category illustration colours. Sanctioned in design.md — not app chrome.
 */
const categoryMeta: Record<
  Exclude<TemplateCategory, 'All'>,
  { icon: ComponentType<{ className?: string }>; accent: string; surface: string }
> = {
  Productivity: { icon: LayoutGrid, accent: '#B8FF5A', surface: '#1A2410' },
  'E-commerce': { icon: ShoppingCart, accent: '#FFBF7A', surface: '#26170C' },
  SaaS: { icon: Cloud, accent: '#8BC7FF', surface: '#0C1B26' },
  Content: { icon: FileText, accent: '#D6A7FF', surface: '#201126' },
  'Internal Tools': { icon: Wrench, accent: '#FFE06A', surface: '#251F09' },
  'Health & Fitness': { icon: Heart, accent: '#FF8F9E', surface: '#270D12' },
  Education: { icon: GraduationCap, accent: '#77E0D3', surface: '#092320' },
};

function paletteFor(category: string) {
  if (category in categoryMeta) return categoryMeta[category as Exclude<TemplateCategory, 'All'>];
  return categoryMeta.Productivity;
}

function catalogHref(state: {
  q: string;
  category: TemplateCategory;
  sort: TemplateSort;
  view: 'grid' | 'list';
  template: string | null;
}): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category !== 'All') params.set('category', state.category);
  if (state.sort !== 'recommended') params.set('sort', state.sort);
  if (state.view === 'list') params.set('view', 'list');
  if (state.template) params.set('template', state.template);
  const qs = params.toString();
  return qs ? `/dashboard/templates?${qs}` : '/dashboard/templates';
}

function CatalogFallback() {
  return (
    <div className="grid min-h-full place-items-center bg-background">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<CatalogFallback />}>
      <TemplatesCatalog />
    </Suspense>
  );
}

function TemplatesCatalog() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: status === 'authenticated',
  });
  const createMutation = trpc.projects.create.useMutation();
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const categoryParam = searchParams.get('category');
  const category = templateCategories.find((item) => item === categoryParam) ?? 'All';
  const sort: TemplateSort = searchParams.get('sort') === 'name' ? 'name' : 'recommended';
  const view = searchParams.get('view') === 'list' ? 'list' : 'grid';
  const selected = templates.find((item) => item.id === searchParams.get('template')) ?? null;
  const selectedGuide = selected ? templateGuides[selected.id] : undefined;

  const urlQuery = searchParams.get('q') ?? '';
  const [search, setSearch] = useState(urlQuery);
  const [seenQuery, setSeenQuery] = useState(urlQuery);

  const [name, setName] = useState(selected?.name ?? '');
  const [brief, setBrief] = useState(selectedGuide?.brief ?? '');
  const [draftFor, setDraftFor] = useState(selected?.id ?? null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pickedOrgId, setPickedOrgId] = useState('');

  // Sync state with URL query parameter
  useEffect(() => {
    if (urlQuery !== seenQuery) {
      setSeenQuery(urlQuery);
      setSearch(urlQuery);
    }
  }, [urlQuery, seenQuery]);

  // Sync state with selected template
  useEffect(() => {
    if (selected && selectedGuide && selected.id !== draftFor) {
      setDraftFor(selected.id);
      setName(selected.name);
      setBrief(selectedGuide.brief);
      setCreateError(null);
    }
  }, [selected, selectedGuide, draftFor]);

  const href = (patch: Partial<Parameters<typeof catalogHref>[0]> = {}) =>
    catalogHref({
      q: patch.q ?? search,
      category: patch.category ?? category,
      sort: patch.sort ?? sort,
      view: patch.view ?? view,
      template: patch.template === undefined ? (selected?.id ?? null) : patch.template,
    });

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
  }, [status, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (selected) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  // replaceState, not router.replace: a navigation on each keystroke drops input focus.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ((params.get('q') ?? '') === search) return;
    const handle = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (search) next.set('q', search);
      else next.delete('q');
      const qs = next.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(window.history.state, '', url);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  const searched = templates.filter((template) => matchesTemplate(template, search));
  const counts: Record<string, number> = {};
  for (const template of searched) {
    counts[template.category] = (counts[template.category] ?? 0) + 1;
  }
  const filtered = sortTemplates(
    searched.filter((template) => category === 'All' || template.category === category),
    sort,
  );
  const orgs = orgsQuery.data ?? [];
  const onlyWorkspace = orgs.length === 1 ? orgs[0] : undefined;
  const orgId =
    pickedOrgId && orgs.some((org) => org.id === pickedOrgId)
      ? pickedOrgId
      : (onlyWorkspace?.id ?? orgs[0]?.id ?? '');
  const showPicks =
    view === 'grid' && category === 'All' && search.trim() === '' && sort === 'recommended';
  const picks = showPicks ? filtered.filter((template) => template.featured).slice(0, 3) : [];
  const pickIds: Record<string, true> = {};
  for (const template of picks) pickIds[template.id] = true;
  const rest = showPicks ? filtered.filter((template) => !pickIds[template.id]) : filtered;

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!selected || creating) return;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > PROJECT_NAME_LIMIT) return;
    if (brief.length > TEMPLATE_BRIEF_LIMIT) return;
    if (orgsQuery.isLoading) return;
    if (!orgId) {
      setCreateError('You need a workspace before this can become a project.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createMutation.mutateAsync({
        name: trimmedName,
        description: brief.trim() || undefined,
        organizationId: orgId,
        templateId: selected.id,
      });
      router.push(`/project/${project.id}`);
    } catch (error) {
      setCreateError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not create the project. Please try again.',
      );
      setCreating(false);
    }
  }

  if (status === 'loading') return <CatalogFallback />;
  if (status === 'unauthenticated') return null;

  const countLabel = filtered.length === 1 ? '1 template' : `${filtered.length} templates`;
  const elsewhere = searched.length - filtered.length;

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-8 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:py-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Workspace
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Templates
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-muted">
              Choose a pattern and name the project. The brief waits in the prompt — nothing is
              generated until you send it.
            </p>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <label htmlFor="template-search" className="sr-only">
              Search templates
            </label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <Input
              ref={searchRef}
              id="template-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && search) {
                  event.preventDefault();
                  setSearch('');
                }
              }}
              placeholder="Search name, screen, or feature"
              autoComplete="off"
              className="pl-10 pr-10"
            />
            {search ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-foreground-muted hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted sm:block">
                /
              </kbd>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="Template categories"
          className="flex flex-wrap gap-1.5 lg:sticky lg:top-8 lg:flex-col lg:self-start"
        >
          {templateCategories.map((item) => {
            const active = item === category;
            const Icon = item === 'All' ? LayoutTemplate : paletteFor(item).icon;
            const count = item === 'All' ? searched.length : (counts[item] ?? 0);
            return (
              <Link
                key={item}
                href={href({ category: item, template: null })}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                  active
                    ? 'bg-primary-light font-medium text-foreground'
                    : 'text-foreground-secondary hover:bg-background-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item}</span>
                <span className="text-xs tabular-nums text-foreground-muted">{count}</span>
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className="text-sm text-foreground-muted">
              {countLabel}
              {category !== 'All' ? ` in ${category}` : ''}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Sort templates"
                className="flex rounded-lg border border-border bg-background-subtle p-1"
              >
                {(
                  [
                    ['recommended', 'Recommended'],
                    ['name', 'A–Z'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={sort === key}
                    onClick={() =>
                      router.replace(href({ sort: key, template: null }), { scroll: false })
                    }
                    className={cn(
                      'h-8 rounded-md px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                      sort === key
                        ? 'bg-background-muted text-foreground'
                        : 'text-foreground-muted hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background-subtle p-1">
                <button
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={view === 'grid'}
                  onClick={() => router.replace(href({ view: 'grid' }), { scroll: false })}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                    view === 'grid'
                      ? 'bg-background-muted text-foreground'
                      : 'text-foreground-muted hover:text-foreground',
                  )}
                >
                  <Grid2X2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={view === 'list'}
                  onClick={() => router.replace(href({ view: 'list' }), { scroll: false })}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                    view === 'list'
                      ? 'bg-background-muted text-foreground'
                      : 'text-foreground-muted hover:text-foreground',
                  )}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
              <Search className="mx-auto h-8 w-8 text-foreground-muted" />
              <h2 className="mt-4 font-semibold">No templates match</h2>
              <p className="mt-2 text-sm text-foreground-muted">
                {search.trim()
                  ? `Nothing for “${search.trim()}”${category !== 'All' ? ` in ${category}` : ''}.`
                  : `Nothing in ${category}.`}
                {elsewhere > 0
                  ? ` ${elsewhere} ${elsewhere === 1 ? 'match is' : 'matches are'} in other categories.`
                  : ''}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {category !== 'All' && elsewhere > 0 ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      router.replace(href({ category: 'All', template: null }), { scroll: false })
                    }
                  >
                    Search all categories
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    router.replace(
                      catalogHref({
                        q: '',
                        category: 'All',
                        sort,
                        view,
                        template: null,
                      }),
                      { scroll: false },
                    );
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          ) : view === 'list' ? (
            <div className="overflow-hidden rounded-xl border border-border">
              {filtered.map((template) => (
                <TemplateRow
                  key={template.id}
                  template={template}
                  href={href({ template: template.id })}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-10">
              {picks.length > 0 ? (
                <section>
                  <h2 className="mb-4 text-sm font-semibold text-foreground-secondary">
                    Good first picks
                  </h2>
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {picks.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        href={href({ template: template.id })}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
              <section>
                {picks.length > 0 ? (
                  <h2 className="mb-4 text-sm font-semibold text-foreground-secondary">
                    More templates
                  </h2>
                ) : null}
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {rest.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      href={href({ template: template.id })}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>

      <Dialog
        open={Boolean(selected && selectedGuide)}
        onOpenChange={(open) => {
          if (open || creating) return;
          router.replace(href({ template: null }), { scroll: false });
        }}
      >
        <DialogContent
          className="max-h-[min(880px,calc(100vh-2rem))] max-w-3xl gap-0 overflow-y-auto p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nameRef.current?.focus();
          }}
        >
          {selected && selectedGuide ? (
            <form onSubmit={(event) => void createProject(event)}>
              <div className="border-b border-border px-5 py-5 pr-14 sm:px-6">
                <DialogHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{selected.category}</Badge>
                    {selected.featured ? <Badge>Featured</Badge> : null}
                  </div>
                  <DialogTitle className="mt-3 text-2xl tracking-[-0.03em]">
                    {selected.name}
                  </DialogTitle>
                  <DialogDescription>{selectedGuide.bestFor}</DialogDescription>
                </DialogHeader>
              </div>
              <div className="grid sm:grid-cols-[240px_minmax(0,1fr)]">
                <div className="border-b border-border p-5 sm:border-b-0 sm:border-r">
                  <TemplateSketch
                    layout={selectedGuide.layout}
                    accent={paletteFor(selected.category).accent}
                    surface={paletteFor(selected.category).surface}
                    className="aspect-[16/10] w-full rounded-xl"
                  />
                  <p className="mt-3 text-xs leading-5 text-foreground-muted">
                    Sketch of the pattern, not a live preview.
                  </p>
                </div>
                <div className="p-5 sm:p-6">
                  <p className="text-sm text-foreground-secondary">
                    <span className="text-foreground-muted">Screens. </span>
                    {selectedGuide.screens.join(', ')}
                  </p>
                  <ul className="mt-4 space-y-2">
                    {selectedGuide.includes.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 text-sm text-foreground-secondary"
                      >
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="template-project-name">Project name</Label>
                      <Input
                        ref={nameRef}
                        id="template-project-name"
                        value={name}
                        maxLength={PROJECT_NAME_LIMIT}
                        autoComplete="off"
                        required
                        onChange={(event) => setName(event.target.value)}
                        disabled={creating}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <Label htmlFor="template-brief">Starting brief</Label>
                        <span className="text-xs tabular-nums text-foreground-muted">
                          {brief.length}/{TEMPLATE_BRIEF_LIMIT}
                        </span>
                      </div>
                      <Textarea
                        id="template-brief"
                        value={brief}
                        maxLength={TEMPLATE_BRIEF_LIMIT}
                        rows={5}
                        disabled={creating}
                        aria-describedby="template-brief-hint"
                        onChange={(event) => setBrief(event.target.value)}
                        className="min-h-32 resize-y"
                      />
                      <p
                        id="template-brief-hint"
                        className="text-xs leading-5 text-foreground-muted"
                      >
                        Saved on the project and placed in the prompt. Send it when you are ready.
                      </p>
                    </div>
                    {orgs.length > 1 ? (
                      <div className="space-y-2">
                        <Label htmlFor="template-org">Workspace</Label>
                        <select
                          id="template-org"
                          value={orgId}
                          disabled={creating}
                          onChange={(event) => setPickedOrgId(event.target.value)}
                          className="flex h-11 w-full rounded-lg border border-border bg-background-muted px-3.5 text-sm text-foreground focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/30"
                        >
                          {orgs.map((org: { id: string; name: string }) => (
                            <option key={org.id} value={org.id}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : onlyWorkspace ? (
                      <p className="text-xs text-foreground-muted">
                        Creates in{' '}
                        <span className="text-foreground-secondary">{onlyWorkspace.name}</span>
                      </p>
                    ) : orgsQuery.isError ? (
                      <p role="alert" className="text-sm text-error">
                        Could not load your workspaces.
                      </p>
                    ) : orgsQuery.isLoading ? (
                      <p className="text-xs text-foreground-muted">Checking workspace…</p>
                    ) : (
                      <p role="alert" className="text-sm text-error">
                        You need a workspace before this can become a project.
                      </p>
                    )}
                  </div>

                  {createError ? (
                    <p role="alert" className="mt-4 text-sm text-error">
                      {createError}
                    </p>
                  ) : null}

                  <DialogFooter className="mt-6">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={creating}
                      onClick={() => router.replace(href({ template: null }), { scroll: false })}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={creating || !name.trim() || !orgId || orgsQuery.isLoading}
                    >
                      {creating ? 'Creating…' : 'Create project'}
                    </Button>
                  </DialogFooter>
                </div>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({ template, href }: { template: Template; href: string }) {
  const guide = templateGuides[template.id];
  if (!guide) return null;
  const meta = paletteFor(template.category);
  return (
    <Link
      href={href}
      scroll={false}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-background-subtle text-left transition-colors hover:border-border-strong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
    >
      <TemplateSketch
        layout={guide.layout}
        accent={meta.accent}
        surface={meta.surface}
        className="aspect-[16/10] w-full"
      />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{template.category}</Badge>
          {template.featured ? <Badge>Featured</Badge> : null}
        </div>
        <h2 className="mt-3 truncate text-base font-semibold tracking-[-0.02em]">
          {template.name}
        </h2>
        <p className="mt-1.5 line-clamp-2 flex-1 text-sm leading-6 text-foreground-muted">
          {template.description}
        </p>
        <span className="mt-4 inline-flex items-center text-xs font-semibold text-foreground-secondary group-hover:text-foreground">
          Review brief
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

function TemplateRow({ template, href }: { template: Template; href: string }) {
  const guide = templateGuides[template.id];
  if (!guide) return null;
  const meta = paletteFor(template.category);
  return (
    <Link
      href={href}
      scroll={false}
      className="flex items-center gap-4 border-b border-border bg-background-subtle px-4 py-3 last:border-0 hover:bg-background-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus/40"
    >
      <TemplateSketch
        layout={guide.layout}
        accent={meta.accent}
        surface={meta.surface}
        className="hidden h-14 w-24 shrink-0 rounded-lg sm:block"
      />
      <span
        className="h-9 w-1 shrink-0 rounded-full sm:hidden"
        style={{ background: meta.accent }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{template.name}</span>
          {template.featured ? <Badge className="shrink-0">Featured</Badge> : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-foreground-muted">
          {template.category}
          {template.description ? ` · ${template.description}` : ''}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-foreground-muted" />
    </Link>
  );
}
