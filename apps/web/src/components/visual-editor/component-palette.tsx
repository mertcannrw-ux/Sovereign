'use client';

import { cn } from '@app-builder/ui/utils';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Search,
  Square,
  Image,
  Table,
  FormInput,
  LayoutGrid,
  PanelTop,
  Sidebar,
  MousePointerClick,
  Bell,
  MessageSquare,
  List,
  ChevronDown,
  ToggleLeft,
  CheckSquare,
} from 'lucide-react';

// ── Component Definitions ──────────────────────────

interface PaletteComponent {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  codeTemplate: string;
}

const PALETTE_COMPONENTS: PaletteComponent[] = [
  // Layout
  {
    id: 'container',
    name: 'Container',
    description: 'Centered content container with max-width',
    icon: Square,
    category: 'Layout',
    codeTemplate: `<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">\n  {/* Content */}\n</div>`,
  },
  {
    id: 'grid',
    name: 'Grid',
    description: 'Responsive grid layout',
    icon: LayoutGrid,
    category: 'Layout',
    codeTemplate: `<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">\n  {/* Grid items */}\n</div>`,
  },
  {
    id: 'flex-row',
    name: 'Flex Row',
    description: 'Horizontal flex container',
    icon: PanelTop,
    category: 'Layout',
    codeTemplate: `<div className="flex items-center gap-4">\n  {/* Flex items */}\n</div>`,
  },
  {
    id: 'sidebar-layout',
    name: 'Sidebar Layout',
    description: 'Sidebar + main content area',
    icon: Sidebar,
    category: 'Layout',
    codeTemplate: `<div className="flex h-screen">\n  <aside className="w-64 border-r border-border p-4">Sidebar</aside>\n  <main className="flex-1 p-6">Content</main>\n</div>`,
  },

  // Navigation
  {
    id: 'navbar',
    name: 'Navbar',
    description: 'Top navigation bar',
    icon: PanelTop,
    category: 'Navigation',
    codeTemplate: `<nav className="flex items-center justify-between border-b border-border px-6 py-3">\n  <div className="text-lg font-semibold">Logo</div>\n  <div className="flex items-center gap-4">\n    <a href="#" className="text-sm text-foreground-secondary hover:text-foreground">Home</a>\n    <a href="#" className="text-sm text-foreground-secondary hover:text-foreground">About</a>\n  </div>\n</nav>`,
  },
  {
    id: 'tabs-nav',
    name: 'Tabs',
    description: 'Tab navigation component',
    icon: List,
    category: 'Navigation',
    codeTemplate: `<div className="border-b border-border">\n  <nav className="flex gap-0 -mb-px">\n    <button className="border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary">Tab 1</button>\n    <button className="border-b-2 border-transparent px-4 py-2 text-sm text-foreground-muted hover:text-foreground">Tab 2</button>\n  </nav>\n</div>`,
  },

  // Forms
  {
    id: 'text-input',
    name: 'Text Input',
    description: 'Labeled text input field',
    icon: FormInput,
    category: 'Forms',
    codeTemplate: `<div className="space-y-1">\n  <label className="text-sm font-medium text-foreground">Label</label>\n  <input type="text" className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Enter text..." />\n</div>`,
  },
  {
    id: 'button-group',
    name: 'Button',
    description: 'Primary action button',
    icon: MousePointerClick,
    category: 'Forms',
    codeTemplate: `<button className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors">\n  Click Me\n</button>`,
  },
  {
    id: 'checkbox',
    name: 'Checkbox',
    description: 'Checkbox with label',
    icon: CheckSquare,
    category: 'Forms',
    codeTemplate: `<label className="flex items-center gap-2">\n  <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />\n  <span className="text-sm text-foreground">Check me</span>\n</label>`,
  },
  {
    id: 'select',
    name: 'Select',
    description: 'Dropdown select input',
    icon: ChevronDown,
    category: 'Forms',
    codeTemplate: `<select className="w-full rounded-md border border-border px-3 py-2 text-sm bg-background focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">\n  <option>Option 1</option>\n  <option>Option 2</option>\n</select>`,
  },
  {
    id: 'toggle',
    name: 'Toggle',
    description: 'Toggle switch',
    icon: ToggleLeft,
    category: 'Forms',
    codeTemplate: `<button className="relative inline-flex h-6 w-11 items-center rounded-full bg-border transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">\n  <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1" />\n</button>`,
  },

  // Content
  {
    id: 'card',
    name: 'Card',
    description: 'Content card container',
    icon: Square,
    category: 'Content',
    codeTemplate: `<div className="rounded-lg border border-border bg-background shadow-sm">\n  <div className="p-6">\n    <h3 className="text-lg font-semibold text-foreground">Card Title</h3>\n    <p className="mt-2 text-sm text-foreground-muted">Card description goes here.</p>\n  </div>\n</div>`,
  },
  {
    id: 'alert',
    name: 'Alert',
    description: 'Notification alert banner',
    icon: Bell,
    category: 'Content',
    codeTemplate: `<div className="rounded-lg border border-border bg-primary-light p-4">\n  <p className="text-sm text-primary">This is an informational alert.</p>\n</div>`,
  },
  {
    id: 'badge',
    name: 'Badge',
    description: 'Status badge / tag',
    icon: MessageSquare,
    category: 'Content',
    codeTemplate: `<span className="inline-flex items-center rounded-full bg-primary-light px-2.5 py-0.5 text-xs font-medium text-primary">\n  Badge\n</span>`,
  },
  {
    id: 'avatar',
    name: 'Avatar',
    description: 'User avatar image',
    icon: Image,
    category: 'Content',
    codeTemplate: `<div className="flex h-10 w-10 items-center justify-center rounded-full bg-background-muted text-sm font-medium text-foreground-secondary">\n  AB\n</div>`,
  },
  {
    id: 'table',
    name: 'Table',
    description: 'Data table',
    icon: Table,
    category: 'Content',
    codeTemplate: `<table className="w-full text-sm">\n  <thead>\n    <tr className="border-b border-border">\n      <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Column</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr className="border-b border-border">\n      <td className="px-4 py-3 text-foreground">Data</td>\n    </tr>\n  </tbody>\n</table>`,
  },
];

// ── Categories ─────────────────────────────────────

const CATEGORIES = ['All', 'Layout', 'Navigation', 'Forms', 'Content'];

// ── Main Component ─────────────────────────────────

interface ComponentPaletteProps {
  onAddComponent: (component: PaletteComponent) => void;
  className?: string;
}

export function ComponentPalette({ onAddComponent, className }: ComponentPaletteProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Components</h3>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <Input placeholder="Search components..." className="h-8 pl-8 text-xs" />
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs defaultValue="All" className="flex-1">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
          {CATEGORIES.map((cat) => (
            <TabsTrigger key={cat} value={cat} className="text-xs">
              {cat}
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORIES.map((cat) => (
          <TabsContent key={cat} value={cat} className="flex-1 overflow-auto p-0">
            <div className="grid grid-cols-2 gap-1 p-2">
              {PALETTE_COMPONENTS.filter((c) => cat === 'All' || c.category === cat).map(
                (component) => (
                  <button
                    key={component.id}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg p-3 text-center transition-all',
                      'hover:bg-background-subtle active:scale-95',
                      'border border-transparent hover:border-border',
                    )}
                    onClick={() => onAddComponent(component)}
                    title={component.description}
                  >
                    <component.icon className="h-5 w-5 text-foreground-secondary" />
                    <span className="text-[11px] font-medium leading-tight text-foreground">
                      {component.name}
                    </span>
                  </button>
                ),
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
