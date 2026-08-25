'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Database,
  Plus,
  Trash2,
  Table2,
  ChevronRight,
  ChevronDown,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@app-builder/ui/utils';

/* ── Types ───────────────────────────────────────────────── */

interface TableInfo {
  tablename: string;
  tableowner: string;
  tablespace: string | null;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  column_name: string;
}

interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  unique: boolean;
  defaultValue: string | null;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/* ── Available column types ───────────────────────────────── */

const COLUMN_TYPES = [
  'TEXT',
  'VARCHAR(255)',
  'INTEGER',
  'BIGINT',
  'BOOLEAN',
  'TIMESTAMP',
  'DATE',
  'FLOAT',
  'JSONB',
  'UUID',
] as const;

/* ── Props ──────────────────────────────────────────────────── */

interface DatabasePanelProps {
  projectId: string;
}

/* ── Component ──────────────────────────────────────────────── */

export function DatabasePanel({ projectId }: DatabasePanelProps) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableSchema, setTableSchema] = useState<{
    columns: ColumnInfo[];
    constraints: ConstraintInfo[];
  } | null>(null);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Monotonic request id so a stale schema response cannot overwrite the schema
  // of a table selected after it; the mounted ref drops results after unmount.
  const schemaRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Create table dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newColumns, setNewColumns] = useState<ColumnDef[]>([
    { name: 'id', type: 'UUID', nullable: false, unique: true, defaultValue: 'gen_random_uuid()' },
  ]);
  const [isCreating, setIsCreating] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // SQL Query
  const [querySql, setQuerySql] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const loadTables = async () => {
    setIsLoadingTables(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/trpc/database.listTables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await response.json();
      if (data.result?.data) {
        setTables(data.result.data);
      } else {
        setLoadError('Failed to load tables');
      }
    } catch {
      setLoadError('Failed to connect to server');
    } finally {
      setIsLoadingTables(false);
    }
  };

  const loadTableSchema = async (tableName: string) => {
    const requestId = ++schemaRequestIdRef.current;
    setSelectedTable(tableName);
    setIsLoadingSchema(true);
    try {
      const response = await fetch('/api/trpc/database.getTableSchema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, tableName }),
      });
      const data = await response.json();
      if (requestId !== schemaRequestIdRef.current || !isMountedRef.current) return;
      if (data.result?.data) {
        setTableSchema(data.result.data);
      }
    } catch {
      // silently fail
    } finally {
      if (requestId === schemaRequestIdRef.current && isMountedRef.current) {
        setIsLoadingSchema(false);
      }
    }
  };

  const handleCreateTable = async () => {
    if (!newTableName.trim() || newColumns.length === 0) return;
    setIsCreating(true);
    try {
      const response = await fetch('/api/trpc/database.createTable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          tableName: newTableName.trim(),
          columns: newColumns,
        }),
      });
      const data = await response.json();
      if (data.result?.data?.success) {
        setShowCreateDialog(false);
        setNewTableName('');
        setNewColumns([
          {
            name: 'id',
            type: 'UUID',
            nullable: false,
            unique: true,
            defaultValue: 'gen_random_uuid()',
          },
        ]);
        await loadTables();
      } else {
        const errorMessage = data.error?.message ?? 'Failed to create table';
        setLoadError(errorMessage);
      }
    } catch {
      setLoadError('Failed to create table');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteTable = async (tableName: string) => {
    setIsDeleting(true);
    try {
      const response = await fetch('/api/trpc/database.deleteTable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, tableName }),
      });
      const data = await response.json();
      if (data.result?.data?.success) {
        setDeleteConfirm(null);
        if (selectedTable === tableName) {
          setSelectedTable(null);
          setTableSchema(null);
        }
        await loadTables();
      }
    } catch {
      // silently fail
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExecuteQuery = async () => {
    if (!querySql.trim()) return;
    setIsQuerying(true);
    setQueryResult(null);
    setQueryError(null);
    try {
      const response = await fetch('/api/trpc/database.executeQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, sql: querySql }),
      });
      const data = await response.json();
      if (data.result?.data) {
        setQueryResult(data.result.data);
      } else {
        const errorMessage = data.error?.message ?? 'Query failed';
        setQueryError(errorMessage);
      }
    } catch {
      setQueryError('Failed to execute query');
    } finally {
      setIsQuerying(false);
    }
  };

  const addColumn = () => {
    setNewColumns([
      ...newColumns,
      { name: '', type: 'TEXT', nullable: true, unique: false, defaultValue: null },
    ]);
  };

  const removeColumn = (index: number) => {
    setNewColumns(newColumns.filter((_, i) => i !== index));
  };

  const updateColumn = (index: number, field: keyof ColumnDef, value: string | boolean | null) => {
    setNewColumns(newColumns.map((col, i) => (i === index ? { ...col, [field]: value } : col)));
  };

  const typeLabel = (type: string): string => {
    const map: Record<string, string> = {
      TEXT: 'Text',
      'VARCHAR(255)': 'Text (255)',
      INTEGER: 'Integer',
      BIGINT: 'Big Integer',
      BOOLEAN: 'Boolean',
      TIMESTAMP: 'Timestamp',
      DATE: 'Date',
      FLOAT: 'Float',
      JSONB: 'JSON',
      UUID: 'UUID',
    };
    return map[type] ?? type;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-foreground">Database</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Manage your project&apos;s database tables, view schemas, and run SQL queries.
        </p>
      </div>

      <Separator />

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadTables}
            disabled={isLoadingTables}
            className="gap-1.5"
          >
            {isLoadingTables ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          <span className="text-sm text-foreground-muted">
            {tables.length} table{tables.length !== 1 ? 's' : ''}
          </span>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreateDialog(true)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Table
        </Button>
      </div>

      {/* Error */}
      {loadError && (
        <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error-light p-3 text-sm text-error">
          <XCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Table list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground-secondary">Tables</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {tables.length === 0 && !isLoadingTables ? (
              <div className="flex flex-col items-center gap-2 px-6 pb-6 pt-2">
                <Table2 className="h-8 w-8 text-foreground-muted" />
                <p className="text-sm text-foreground-muted">
                  No tables yet. Create one to get started.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[320px]">
                <div className="divide-y divide-border">
                  {tables.map((table) => (
                    <div
                      key={table.tablename}
                      className={cn(
                        'flex cursor-pointer items-center justify-between px-4 py-2.5 transition-colors hover:bg-background-muted',
                        selectedTable === table.tablename && 'bg-primary-light',
                      )}
                      onClick={() => loadTableSchema(table.tablename)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {selectedTable === table.tablename ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-foreground-muted" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-foreground-muted" />
                        )}
                        <span className="truncate text-sm font-medium text-foreground">
                          {table.tablename}
                        </span>
                      </div>
                      {deleteConfirm === table.tablename ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTable(table.tablename);
                            }}
                            disabled={isDeleting}
                            className="h-7 px-2 text-xs"
                          >
                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm(null);
                            }}
                            className="h-7 px-2 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(table.tablename);
                          }}
                          className="shrink-0 text-foreground-muted hover:text-error"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Schema viewer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground-secondary">
              {selectedTable ? `Schema: ${selectedTable}` : 'Schema'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTable && (
              <div className="flex flex-col items-center gap-2 py-8">
                <Database className="h-8 w-8 text-foreground-muted" />
                <p className="text-sm text-foreground-muted">Select a table to view its schema</p>
              </div>
            )}
            {selectedTable && isLoadingSchema && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
              </div>
            )}
            {selectedTable && !isLoadingSchema && tableSchema && (
              <ScrollArea className="max-h-[320px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-3 font-medium text-foreground-secondary">Column</th>
                      <th className="pb-2 pr-3 font-medium text-foreground-secondary">Type</th>
                      <th className="pb-2 pr-3 font-medium text-foreground-secondary">Nullable</th>
                      <th className="pb-2 font-medium text-foreground-secondary">Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableSchema.columns.map((col) => (
                      <tr key={col.column_name} className="border-b border-border/50">
                        <td className="py-2 pr-3 font-mono text-xs text-foreground">
                          {col.column_name}
                        </td>
                        <td className="py-2 pr-3 text-xs text-foreground-secondary">
                          {col.data_type}
                          {col.character_maximum_length ? `(${col.character_maximum_length})` : ''}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant={col.is_nullable === 'YES' ? 'secondary' : 'default'}>
                            {col.is_nullable === 'YES' ? 'YES' : 'NO'}
                          </Badge>
                        </td>
                        <td className="py-2 font-mono text-xs text-foreground-muted">
                          {col.column_default ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {tableSchema.constraints.length > 0 && (
                  <div className="mt-4">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                      Constraints
                    </h4>
                    <div className="space-y-1">
                      {tableSchema.constraints.map((con, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="font-mono">
                            {con.constraint_type}
                          </Badge>
                          <span className="text-foreground-secondary">{con.column_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SQL Query */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground-secondary">SQL Query</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder='SELECT * FROM "tablename" LIMIT 10'
            value={querySql}
            onChange={(e) => setQuerySql(e.target.value)}
            className="min-h-[100px] font-mono text-sm"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-foreground-muted">Read-only queries only (SELECT / WITH)</p>
            <Button
              variant="default"
              size="sm"
              onClick={handleExecuteQuery}
              disabled={isQuerying || !querySql.trim()}
              className="gap-1.5"
            >
              {isQuerying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
          </div>

          {/* Query error */}
          {queryError && (
            <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error-light p-3 text-sm text-error">
              <XCircle className="h-4 w-4 shrink-0" />
              {queryError}
            </div>
          )}

          {/* Query results */}
          {queryResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-foreground-muted">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                {queryResult.rowCount} row{queryResult.rowCount !== 1 ? 's' : ''} returned
              </div>
              {queryResult.rows.length > 0 && queryResult.rows[0] !== undefined && (
                <ScrollArea className="max-h-[300px] rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-background-muted">
                        {Object.keys(queryResult.rows[0]).map((key) => (
                          <th
                            key={key}
                            className="px-3 py-2 text-left text-xs font-medium text-foreground-secondary"
                          >
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.rows.map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className={cn(
                            'border-b border-border/50',
                            rowIdx % 2 === 0 ? 'bg-background' : 'bg-background-subtle',
                          )}
                        >
                          {Object.values(row).map((value, colIdx) => (
                            <td
                              key={colIdx}
                              className="px-3 py-2 font-mono text-xs text-foreground"
                            >
                              {value === null ? (
                                <span className="italic text-foreground-muted">NULL</span>
                              ) : (
                                String(value)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create Table Dialog ────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Table</DialogTitle>
            <DialogDescription>
              Define the name and columns for your new database table.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Table name */}
            <div className="space-y-2">
              <Label>Table Name</Label>
              <Input
                placeholder="e.g. products, users, orders"
                value={newTableName}
                onChange={(e) =>
                  setNewTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }
              />
              <p className="text-xs text-foreground-muted">
                Lowercase letters, numbers, and underscores only.
              </p>
            </div>

            <Separator />

            {/* Columns */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Columns</Label>
                <Button variant="outline" size="sm" onClick={addColumn} className="gap-1">
                  <Plus className="h-3 w-3" />
                  Add Column
                </Button>
              </div>

              {newColumns.map((col, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex-1 space-y-2">
                    <Input
                      placeholder="Column name"
                      value={col.name}
                      onChange={(e) =>
                        updateColumn(
                          idx,
                          'name',
                          e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                        )
                      }
                      className="h-8 text-sm"
                    />
                    <Select value={col.type} onValueChange={(v) => updateColumn(idx, 'type', v)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COLUMN_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {typeLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-3">
                      <Label className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                        <input
                          type="checkbox"
                          checked={!col.nullable}
                          onChange={(e) => updateColumn(idx, 'nullable', !e.target.checked)}
                          className="rounded border-border"
                        />
                        Required
                      </Label>
                      <Label className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                        <input
                          type="checkbox"
                          checked={col.unique}
                          onChange={(e) => updateColumn(idx, 'unique', e.target.checked)}
                          className="rounded border-border"
                        />
                        Unique
                      </Label>
                    </div>
                    <Input
                      placeholder="Default value (e.g. now(), gen_random_uuid())"
                      value={col.defaultValue ?? ''}
                      onChange={(e) => updateColumn(idx, 'defaultValue', e.target.value || null)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeColumn(idx)}
                    className="mt-1 shrink-0 text-foreground-muted hover:text-error"
                    disabled={newColumns.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleCreateTable}
              disabled={
                isCreating || !newTableName.trim() || newColumns.some((c) => !c.name.trim())
              }
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Table'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
