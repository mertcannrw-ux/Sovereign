'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  FileText,
  GraduationCap,
  Heart,
  LayoutGrid,
  Search,
  ShoppingCart,
  Sparkles,
  Star,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/lib/trpc/client';
import { templates, templateCategories, type TemplateCategory } from '@/data/templates';

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
  Productivity: LayoutGrid,
  'E-commerce': ShoppingCart,
  SaaS: Cloud,
  Content: FileText,
  'Internal Tools': Wrench,
  'Health & Fitness': Heart,
  Education: GraduationCap,
};
const palettes: Record<string, [string, string]> = {
  Productivity: ['#B8FF5A', '#1A2410'],
  'E-commerce': ['#FFBF7A', '#26170C'],
  SaaS: ['#8BC7FF', '#0C1B26'],
  Content: ['#D6A7FF', '#201126'],
  'Internal Tools': ['#FFE06A', '#251F09'],
  'Health & Fitness': ['#FF8F9E', '#270D12'],
  Education: ['#77E0D3', '#092320'],
};

export default function TemplatesPage() {
  const { status } = useSession();
  const router = useRouter();
  const orgsQuery = trpc.organizations.list.useQuery();
  const createMutation = trpc.projects.create.useMutation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('All');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
  }, [status, router]);
  const filtered = useMemo(
    () =>
      templates.filter(
        (t) =>
          (category === 'All' || t.category === category) &&
          `${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [category, search],
  );

  async function instantiateTemplate(template: (typeof templates)[number]) {
    if (creatingId) return;
    const orgId = orgsQuery.data?.[0]?.id;
    if (!orgId) return;
    setCreatingId(template.id);
    setCreateError(null);
    try {
      const project = await createMutation.mutateAsync({
        name: template.name,
        description: template.description ?? undefined,
        organizationId: orgId,
      });
      router.push(`/project/${project.id}`);
    } catch {
      setCreateError(`Could not create “${template.name}”. Please try again.`);
      setCreatingId(null);
    }
  }

  if (status === 'loading')
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-[1400px] px-5 py-9 sm:px-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard')}
            className="-ml-3 mb-7 text-foreground-muted"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Projects
          </Button>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Template library
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
                Start with structure.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-muted">
                Production-minded starting points designed to be remixed with your brand and
                requirements.
              </p>
            </div>
            <div className="relative w-full lg:max-w-sm">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates"
                className="pl-10"
              />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8">
        <div className="mb-8 flex gap-2 overflow-x-auto pb-2">
          {templateCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${category === cat ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background-subtle text-foreground-muted hover:border-border-strong hover:text-foreground'}`}
            >
              {cat}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-20 text-center">
            <Search className="mx-auto h-8 w-8 text-foreground-muted" />
            <h2 className="mt-4 font-semibold">No templates found</h2>
            <p className="mt-2 text-sm text-foreground-muted">
              Try a different category or search.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isCreating={creatingId === template.id}
                disabled={creatingId !== null && creatingId !== template.id}
                onUse={() => void instantiateTemplate(template)}
              />
            ))}
          </div>
        )}
        {createError ? (
          <p role="alert" className="mt-6 text-center text-sm text-error">
            {createError}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function TemplateCard({
  template,
  isCreating,
  disabled,
  onUse,
}: {
  template: (typeof templates)[number];
  isCreating: boolean;
  disabled: boolean;
  onUse: () => void;
}) {
  const Icon = icons[template.category] ?? LayoutGrid;
  const [accent, dark] = palettes[template.category] ?? ['#B8FF5A', '#1A2410'];
  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-background-subtle transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_24px_60px_rgba(0,0,0,.3)]">
      <div className="relative aspect-[16/10] overflow-hidden p-6" style={{ background: dark }}>
        <div
          className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-xl bg-black/20"
          style={{ color: accent }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="absolute bottom-5 left-5 right-5 rounded-xl border border-white/10 bg-black/25 p-4 backdrop-blur-sm">
          <div className="h-2 w-1/3 rounded-full" style={{ background: accent }} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <span className="h-12 rounded-md bg-white/[0.07]" />
            <span className="h-12 rounded-md bg-white/[0.07]" />
            <span className="h-12 rounded-md bg-white/[0.07]" />
          </div>
        </div>
        {template.featured && (
          <span className="absolute left-5 top-5 flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            <Star className="h-3 w-3" />
            Featured
          </span>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Badge variant="secondary">{template.category}</Badge>
            <h2 className="mt-4 text-lg font-semibold tracking-[-0.025em]">{template.name}</h2>
          </div>
          <span className="text-xs text-foreground-muted">
            {template.cloneCount.toLocaleString()} uses
          </span>
        </div>
        <p className="mt-3 min-h-12 text-sm leading-6 text-foreground-muted">
          {template.description}
        </p>
        <Button
          variant="outline"
          className="mt-5 w-full justify-between group-hover:border-primary/40"
          onClick={onUse}
          disabled={isCreating || disabled}
        >
          {isCreating ? (
            <>
              <span className="flex items-center">
                <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Creating…
              </span>
            </>
          ) : (
            <span className="flex items-center">
              <Sparkles className="mr-2 h-4 w-4 text-primary" />
              Use template
            </span>
          )}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}
