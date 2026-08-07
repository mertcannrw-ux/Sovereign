'use client';

import { useState, useCallback, useMemo } from 'react';
import { cn } from '@app-builder/ui/utils';
import { File, FileCode, FileJson, Folder, FolderOpen } from 'lucide-react';

// ── Types ──────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: TreeNode[];
}

interface FileTreeProps {
  files: string[];
  activeFile: string;
  onSelectFile: (path: string) => void;
  className?: string;
}

// ── Tree builder ───────────────────────────────────

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const fullPath of paths) {
    const parts = fullPath.split('/');
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const part = parts[i]!;
      const currentPath = parts.slice(0, i + 1).join('/');

      if (isLast) {
        // File node
        currentLevel.push({
          name: part,
          path: currentPath,
          type: 'file',
          children: [],
        });
      } else {
        // Directory node — find or create
        const existing = currentLevel.find((n) => n.type === 'directory' && n.name === part);
        if (existing) {
          currentLevel = existing.children;
        } else {
          const newNode: TreeNode = {
            name: part,
            path: currentPath,
            type: 'directory',
            children: [],
          };
          currentLevel.push(newNode);
          currentLevel = newNode.children;
        }
      }
    }
  }

  // Sort: directories first, then alphabetically
  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── File icon helper ───────────────────────────────

function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return FileCode;
    case 'json':
      return FileJson;
    default:
      return File;
  }
}

// ── Tree Node Component ────────────────────────────

function TreeNodeItem({
  node,
  depth,
  activeFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string;
  onSelectFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const Icon = getFileIcon(node.path);
  const isActive = node.path === activeFile;

  const handleClick = useCallback(() => {
    if (node.type === 'directory') {
      setExpanded((prev) => !prev);
    } else {
      onSelectFile(node.path);
    }
  }, [node.type, node.path, onSelectFile]);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors',
          'hover:bg-background-muted',
          isActive && 'bg-primary-light text-primary hover:bg-primary-light',
          !isActive && 'text-foreground-secondary',
          depth > 0 && 'pl-0',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={node.path}
      >
        {node.type === 'directory' ? (
          expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
          )
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {node.type === 'directory' && expanded && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── Main Component ─────────────────────────────────

export function FileTree({ files, activeFile, onSelectFile, className }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden bg-background', className)}>
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
          Files
        </h3>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && (
          <p className="px-3 py-4 text-xs text-foreground-muted">No files yet</p>
        )}
        {tree.map((node) => (
          <TreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            activeFile={activeFile}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </div>
  );
}
