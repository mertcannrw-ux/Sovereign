'use client';

import { useState, useCallback } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Palette, Type, Layout, Box, Trash2, Copy, GripVertical } from 'lucide-react';

// ── Types ──────────────────────────────────────────

interface ElementStyle {
  id: string;
  tagName: string;
  tailwindClasses: string[];
  inlineStyles: Record<string, string>;
  textContent: string;
  children: string[];
}

// ── Color Picker ───────────────────────────────────

const TAILWIND_COLORS: { label: string; value: string; hex: string }[] = [
  { label: 'Slate', value: 'slate', hex: '#64748B' },
  { label: 'Gray', value: 'gray', hex: '#6B7280' },
  { label: 'Zinc', value: 'zinc', hex: '#71717A' },
  { label: 'Neutral', value: 'neutral', hex: '#737373' },
  { label: 'Stone', value: 'stone', hex: '#78716C' },
  { label: 'Red', value: 'red', hex: '#EF4444' },
  { label: 'Orange', value: 'orange', hex: '#F97316' },
  { label: 'Amber', value: 'amber', hex: '#F59E0B' },
  { label: 'Yellow', value: 'yellow', hex: '#EAB308' },
  { label: 'Lime', value: 'lime', hex: '#84CC16' },
  { label: 'Green', value: 'green', hex: '#10B981' },
  { label: 'Emerald', value: 'emerald', hex: '#34D399' },
  { label: 'Teal', value: 'teal', hex: '#14B8A6' },
  { label: 'Cyan', value: 'cyan', hex: '#06B6D4' },
  { label: 'Sky', value: 'sky', hex: '#0EA5E9' },
  { label: 'Blue', value: 'blue', hex: '#2563EB' },
  { label: 'Indigo', value: 'indigo', hex: '#4F46E5' },
  { label: 'Violet', value: 'violet', hex: '#8B5CF6' },
  { label: 'Purple', value: 'purple', hex: '#A855F7' },
  { label: 'Fuchsia', value: 'fuchsia', hex: '#D946EF' },
  { label: 'Pink', value: 'pink', hex: '#EC4899' },
  { label: 'Rose', value: 'rose', hex: '#F43F5E' },
];

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

// ── Main Component ─────────────────────────────────

interface PropertiesPanelProps {
  selectedElement: ElementStyle | null;
  onUpdateClasses: (classes: string[]) => void;
  onDelete: () => void;
  className?: string;
}

export function PropertiesPanel({
  selectedElement,
  onUpdateClasses,
  onDelete,
  className,
}: PropertiesPanelProps) {
  if (!selectedElement) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6', className)}>
        <div className="text-center">
          <Box className="mx-auto h-8 w-8 text-foreground-muted" />
          <p className="mt-2 text-sm text-foreground-muted">
            Select an element in the preview to edit its properties
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-foreground-muted" />
          <span className="font-mono text-sm font-medium text-foreground">
            &lt;{selectedElement.tagName}&gt;
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-error" />
          </Button>
        </div>
      </div>

      {/* Properties Tabs */}
      <Tabs defaultValue="style" className="flex-1">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-4">
          <TabsTrigger value="style" className="flex items-center gap-1.5 text-xs">
            <Palette className="h-3.5 w-3.5" />
            Style
          </TabsTrigger>
          <TabsTrigger value="typography" className="flex items-center gap-1.5 text-xs">
            <Type className="h-3.5 w-3.5" />
            Type
          </TabsTrigger>
          <TabsTrigger value="layout" className="flex items-center gap-1.5 text-xs">
            <Layout className="h-3.5 w-3.5" />
            Layout
          </TabsTrigger>
        </TabsList>

        {/* Style Tab */}
        <TabsContent value="style" className="flex-1 overflow-auto p-4">
          <StyleEditor element={selectedElement} onUpdateClasses={onUpdateClasses} />
        </TabsContent>

        {/* Typography Tab */}
        <TabsContent value="typography" className="flex-1 overflow-auto p-4">
          <TypographyEditor element={selectedElement} onUpdateClasses={onUpdateClasses} />
        </TabsContent>

        {/* Layout Tab */}
        <TabsContent value="layout" className="flex-1 overflow-auto p-4">
          <LayoutEditor element={selectedElement} onUpdateClasses={onUpdateClasses} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Style Editor ───────────────────────────────────

function StyleEditor({
  element,
  onUpdateClasses,
}: {
  element: ElementStyle;
  onUpdateClasses: (classes: string[]) => void;
}) {
  const [selectedColor, setSelectedColor] = useState('blue');
  const [selectedShade, setSelectedShade] = useState('500');

  const updateClass = useCallback(
    (oldPrefix: string, newClass: string) => {
      const filtered = element.tailwindClasses.filter((c) => !c.startsWith(oldPrefix));
      onUpdateClasses([...filtered, newClass]);
    },
    [element.tailwindClasses, onUpdateClasses],
  );

  const hasClass = (prefix: string) => element.tailwindClasses.some((c) => c.startsWith(prefix));

  return (
    <div className="space-y-6">
      {/* Background Color */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">
          Background Color
        </Label>
        <div className="grid grid-cols-8 gap-1">
          {TAILWIND_COLORS.slice(0, 8).map((color) => (
            <button
              key={color.value}
              className={cn(
                'h-6 w-6 rounded border border-border transition-all hover:scale-110',
                selectedColor === color.value && 'ring-2 ring-primary ring-offset-1',
              )}
              style={{ backgroundColor: color.hex }}
              title={color.label}
              onClick={() => {
                setSelectedColor(color.value);
                updateClass('bg-', `bg-${color.value}-${selectedShade}`);
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1">
          {SHADES.slice(0, 10).map((shade) => (
            <button
              key={shade}
              className={cn(
                'h-5 flex-1 rounded text-[10px] transition-all',
                selectedShade === shade
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background-muted text-foreground-muted hover:bg-border',
              )}
              onClick={() => {
                setSelectedShade(shade);
                updateClass('bg-', `bg-${selectedColor}-${shade}`);
              }}
            >
              {shade}
            </button>
          ))}
        </div>
      </div>

      {/* Text Color */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">
          Text Color
        </Label>
        <div className="grid grid-cols-8 gap-1">
          {TAILWIND_COLORS.slice(0, 8).map((color) => (
            <button
              key={color.value}
              className="h-6 w-6 rounded border border-border transition-all hover:scale-110"
              style={{ backgroundColor: color.hex }}
              title={color.label}
              onClick={() => updateClass('text-', `text-${color.value}-${selectedShade}`)}
            />
          ))}
        </div>
      </div>

      <Separator />

      {/* Border Radius */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">
          Border Radius
        </Label>
        <div className="flex gap-2">
          {[
            { label: 'None', cls: 'rounded-none', preview: '0' },
            { label: 'SM', cls: 'rounded-sm', preview: '2' },
            { label: 'MD', cls: 'rounded-md', preview: '6' },
            { label: 'LG', cls: 'rounded-lg', preview: '8' },
            { label: 'XL', cls: 'rounded-xl', preview: '12' },
            { label: 'Full', cls: 'rounded-full', preview: '∞' },
          ].map((opt) => (
            <button
              key={opt.cls}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded border text-xs transition-all',
                hasClass(opt.cls)
                  ? 'border-primary bg-primary-light text-primary'
                  : 'border-border hover:border-border-strong',
              )}
              onClick={() => updateClass('rounded', opt.cls)}
              title={opt.label}
            >
              {opt.preview}
            </button>
          ))}
        </div>
      </div>

      {/* Shadow */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">Shadow</Label>
        <div className="flex gap-2">
          {[
            { label: 'None', cls: 'shadow-none' },
            { label: 'SM', cls: 'shadow-sm' },
            { label: 'MD', cls: 'shadow' },
            { label: 'LG', cls: 'shadow-lg' },
            { label: 'XL', cls: 'shadow-xl' },
          ].map((opt) => (
            <Button
              key={opt.cls}
              variant={hasClass(opt.cls) ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateClass('shadow', opt.cls)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Typography Editor ──────────────────────────────

function TypographyEditor({
  element,
  onUpdateClasses,
}: {
  element: ElementStyle;
  onUpdateClasses: (classes: string[]) => void;
}) {
  const updateClass = useCallback(
    (oldPrefix: string, newClass: string) => {
      const filtered = element.tailwindClasses.filter((c) => !c.startsWith(oldPrefix));
      onUpdateClasses([...filtered, newClass]);
    },
    [element.tailwindClasses, onUpdateClasses],
  );

  return (
    <div className="space-y-6">
      {/* Font Size */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">
          Font Size
        </Label>
        <div className="flex gap-2">
          {['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'].map((size) => (
            <Button
              key={size}
              variant="outline"
              size="sm"
              onClick={() => updateClass('text-', `text-${size}`)}
              className="font-mono text-xs"
            >
              {size}
            </Button>
          ))}
        </div>
      </div>

      {/* Font Weight */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">
          Font Weight
        </Label>
        <div className="flex gap-2">
          {[
            { label: 'Light', cls: 'font-light' },
            { label: 'Normal', cls: 'font-normal' },
            { label: 'Medium', cls: 'font-medium' },
            { label: 'Semibold', cls: 'font-semibold' },
            { label: 'Bold', cls: 'font-bold' },
          ].map((opt) => (
            <Button
              key={opt.cls}
              variant="outline"
              size="sm"
              onClick={() => updateClass('font-', opt.cls)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Text Align */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">
          Text Align
        </Label>
        <div className="flex gap-2">
          {['text-left', 'text-center', 'text-right'].map((cls) => (
            <Button key={cls} variant="outline" size="sm" onClick={() => updateClass('text-', cls)}>
              {cls.replace('text-', '')}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Layout Editor ──────────────────────────────────

function LayoutEditor({
  element,
  onUpdateClasses,
}: {
  element: ElementStyle;
  onUpdateClasses: (classes: string[]) => void;
}) {
  const updateClass = useCallback(
    (oldPrefix: string, newClass: string) => {
      const filtered = element.tailwindClasses.filter((c) => !c.startsWith(oldPrefix));
      onUpdateClasses([...filtered, newClass]);
    },
    [element.tailwindClasses, onUpdateClasses],
  );

  return (
    <div className="space-y-6">
      {/* Display */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">Display</Label>
        <div className="flex gap-2">
          {['block', 'inline-block', 'inline', 'flex', 'grid', 'hidden'].map((d) => (
            <Button
              key={d}
              variant="outline"
              size="sm"
              onClick={() => updateClass(/^(block|inline|flex|grid|hidden)/.source, d)}
              className="text-xs"
            >
              {d}
            </Button>
          ))}
        </div>
      </div>

      {/* Padding */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">Padding</Label>
        <div className="flex gap-2">
          {['0', '1', '2', '3', '4', '5', '6', '8', '10', '12'].map((n) => (
            <Button
              key={n}
              variant="outline"
              size="sm"
              onClick={() => updateClass('p-', `p-${n}`)}
              className="font-mono text-xs"
            >
              {n}
            </Button>
          ))}
        </div>
      </div>

      {/* Margin */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">Margin</Label>
        <div className="flex gap-2">
          {['0', '1', '2', '3', '4', '5', '6', '8', '10', '12'].map((n) => (
            <Button
              key={n}
              variant="outline"
              size="sm"
              onClick={() => updateClass('m-', `m-${n}`)}
              className="font-mono text-xs"
            >
              {n}
            </Button>
          ))}
        </div>
      </div>

      {/* Width */}
      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground-secondary">Width</Label>
        <div className="flex gap-2">
          {['auto', 'full', 'screen', '1/2', '1/3', '2/3', '1/4', '3/4'].map((w) => (
            <Button
              key={w}
              variant="outline"
              size="sm"
              onClick={() => updateClass('w-', `w-${w}`)}
              className="text-xs"
            >
              {w}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
