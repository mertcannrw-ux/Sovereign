'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Template } from '@app-builder/shared';
import { Search } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { templateCategories, templates, type TemplateCategory } from '@/data/templates';

/** Every search word must appear in the name or description. */
function matchesQuery(template: Template, query: string): boolean {
  const haystack = `${template.name}\n${template.description}`.toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/**
 * Searchable template list. Keyboard focus stays in the search box: arrows
 * move the active row and Enter picks it. `onPick` runs once the dialog has
 * closed, so the caller can take focus without the dialog handing it back.
 */
export function TemplatePicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (template: Template) => void;
}) {
  const picked = useRef<Template | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[min(560px,calc(100vh-4rem))] max-w-[640px] flex-col overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          const template = picked.current;
          if (!template) return;
          picked.current = null;
          event.preventDefault();
          onPick(template);
        }}
      >
        <DialogTitle className="sr-only">Templates</DialogTitle>
        {/* Mounted only while open, so search and category reset each time. */}
        <PickerBody
          onChoose={(template) => {
            picked.current = template;
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ onChoose }: { onChoose: (template: Template) => void }) {
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('All');
  const [active, setActive] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const results = useMemo(
    () =>
      templates.filter(
        (template) =>
          (category === 'All' || template.category === category) && matchesQuery(template, query),
      ),
    [query, category],
  );

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  /** Shows the scrollbar while the list moves, then lets it fade back out. */
  function handleScroll() {
    setScrolling(true);
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setScrolling(false), 800);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const template = results[active];
      if (template) onChoose(template);
    }
  }

  return (
    <>
      {/* The list scrolls in its own box below, so rows never pass under this header. */}
      <div className="shrink-0 border-b border-border bg-background-subtle">
        <div className="relative border-b border-border">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            ref={searchRef}
            autoFocus
            type="text"
            role="combobox"
            aria-label="Search templates"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            placeholder="Search templates"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={handleKeyDown}
            className="h-14 w-full bg-transparent pl-11 pr-12 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus-visible:ring-0"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {templateCategories.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={category === name}
              onClick={() => {
                setCategory(name);
                setActive(0);
                searchRef.current?.focus();
              }}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                category === name
                  ? 'bg-background-muted text-foreground'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div
        data-scrolling={scrolling || undefined}
        onScroll={handleScroll}
        className={cn(
          'min-h-0 scroll-py-2 overflow-y-auto px-2 py-2',
          '[scrollbar-color:transparent_transparent] [scrollbar-width:thin] hover:[scrollbar-color:var(--scrollbar)_transparent] data-[scrolling]:[scrollbar-color:var(--scrollbar)_transparent]',
          '[&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-scrollbar data-[scrolling]:[&::-webkit-scrollbar-thumb]:bg-scrollbar',
        )}
      >
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-foreground-muted">No templates match.</p>
        ) : (
          <ul ref={listRef} id={listId} role="listbox" aria-label="Templates">
            {results.map((template, index) => (
              <li
                key={template.id}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                onMouseMove={() => setActive(index)}
                onClick={() => onChoose(template)}
                className={cn(
                  'flex cursor-pointer items-center gap-4 rounded-item px-2 py-3',
                  index === active && 'bg-background-muted',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {template.name}
                  </div>
                  <div className="truncate text-xs text-foreground-muted">
                    {template.description}
                  </div>
                </div>
                {category === 'All' && (
                  <span className="shrink-0 text-xs text-foreground-muted">
                    {template.category}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
