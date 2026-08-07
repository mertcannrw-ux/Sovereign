'use client';

import { useState } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2, Code, Loader2, Power, PowerOff } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface FunctionsPanelProps {
  className?: string;
}

type FunctionFormData = {
  path: string;
  method: string;
  code: string;
};

const DEFAULT_CODE = [
  '// Handler for your API endpoint',
  'export async function handler(req: Request): Promise<Response> {',
  '  return new Response(',
  '    JSON.stringify({ message: "Hello from your function!" }),',
  '    { headers: { "Content-Type": "application/json" } },',
  '  );',
  '}',
].join('\n');

const EMPTY_FORM: FunctionFormData = {
  path: '/api/hello',
  method: 'GET',
  code: DEFAULT_CODE,
};

const METHOD_COLORS: Record<string, 'success' | 'warning' | 'default' | 'error'> = {
  GET: 'success',
  POST: 'warning',
  PUT: 'default',
  PATCH: 'default',
  DELETE: 'error',
};

// ── Component ─────────────────────────────────────────────────

export function FunctionsPanel({ className }: FunctionsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFunction, setEditingFunction] = useState<{
    id: string;
    path: string;
    method: string;
    code: string;
  } | null>(null);
  const [form, setForm] = useState<FunctionFormData>(EMPTY_FORM);

  // ── Mock state (tRPC pending) ────────────────────────
  const functions: { id: string; path: string; method: string; code: string; enabled: boolean }[] =
    [];
  const isLoading = false;

  function resetAndClose() {
    setDialogOpen(false);
    setEditingFunction(null);
    setForm(EMPTY_FORM);
  }

  // ── Form handlers ────────────────────────────────────────

  function openCreateDialog() {
    setEditingFunction(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEditDialog(func: { id: string; path: string; method: string; code: string }) {
    setEditingFunction(func);
    setForm({
      path: func.path,
      method: func.method,
      code: func.code,
    });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!form.path.trim()) return;
    // Mock save — tRPC pending
    resetAndClose();
  }

  function handleToggleEnabled(_func: { id: string; enabled: boolean }) {
    // Mock toggle — tRPC pending
  }

  function handleDelete(_func: { id: string }) {
    // Mock delete — tRPC pending
  }
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Backend Functions
          </span>
          <Button onClick={openCreateDialog} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Function
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          </div>
        ) : !functions || functions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Code className="h-8 w-8 text-foreground-muted" />
            <p className="text-sm text-foreground-muted">No backend functions yet</p>
            <p className="text-xs text-foreground-muted">
              Create your first API endpoint to handle server-side logic.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {functions.map((func) => (
              <li
                key={func.id}
                className="flex items-center justify-between rounded-lg border border-border bg-background-subtle p-3 transition-colors hover:bg-background-muted"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Badge
                    variant={METHOD_COLORS[func.method] ?? 'default'}
                    className="shrink-0 font-mono text-xs"
                  >
                    {func.method}
                  </Badge>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{func.path}</p>
                    <p className="text-xs text-foreground-muted">
                      {func.enabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleToggleEnabled(func)}
                    aria-label={func.enabled ? 'Disable' : 'Enable'}
                  >
                    {func.enabled ? (
                      <Power className="h-4 w-4 text-success" />
                    ) : (
                      <PowerOff className="h-4 w-4 text-foreground-muted" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEditDialog(func)}
                    aria-label="Edit function"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(func)}
                    aria-label="Delete function"
                    disabled={false}
                  >
                    {false ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-error" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* ── Create / Edit Dialog ─────────────────────────── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingFunction ? 'Edit Function' : 'Create Function'}</DialogTitle>
              <DialogDescription>
                {editingFunction
                  ? 'Update the endpoint path, HTTP method, or handler code.'
                  : 'Define a new backend API endpoint for your project.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Method + Path */}
              <div className="flex gap-3">
                <div className="w-32">
                  <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                    Method
                  </label>
                  <Select
                    value={form.method}
                    onValueChange={(v) => setForm({ ...form, method: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                      <SelectItem value="DELETE">DELETE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                    Path
                  </label>
                  <Input
                    placeholder="/api/hello"
                    value={form.path}
                    onChange={(e) => setForm({ ...form, path: e.target.value })}
                  />
                </div>
              </div>

              {/* Code Editor */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                  Handler Code
                </label>
                <Textarea
                  className="min-h-[240px] font-mono text-xs leading-relaxed"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="export async function handler(req: Request): Promise<Response> { ... }"
                />
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSave} disabled={!form.path.trim() || false || false}>
                {false || false ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {editingFunction ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
