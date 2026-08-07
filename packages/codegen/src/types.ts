// Types for the Code Generation Engine — pure stages, no in-memory state

import type { FileOperation } from '@app-builder/shared';

// ─── Core types ───────────────────────────────────────────

export interface FileChange {
  path: string;
  operation: FileOperation;
  content?: string;
}

export interface Diagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = 'complete' | 'needs_input' | 'failed';

export interface GenerationResult {
  message: string;
  changes: FileChange[];
  diagnostics: Diagnostic[];
  usage: TokenUsage;
  finishReason: FinishReason;
}

// ─── Engine configuration ─────────────────────────────────

export interface EngineConfig {
  techStack: {
    framework: 'react';
    language: 'typescript';
    styling: 'tailwind';
    components: 'shadcn';
    bundler: 'vite';
  };
  maxTokens?: number;
  temperature?: number;
}

// ─── System prompt context ────────────────────────────────

export interface SystemPromptContext {
  /** Current file manifest: path → contentHash */
  manifest: Record<string, string>;
  /** Only relevant file contents (not the entire project) */
  relevantFiles: { path: string; content: string }[];
  userRequirements: string;
  projectSettings: {
    name: string;
    description?: string;
    techStack: EngineConfig['techStack'];
  };
  /** Budget constraints */
  budget: {
    maxInputTokens: number;
    maxOutputFiles: number;
    maxOutputBytes: number;
  };
}

// ─── Repository interface (for transactional application) ─

export interface SnapshotRepository {
  /** Get the current snapshot manifest */
  getManifest(projectId: string): Promise<Record<string, string>>;
  /** Get file content by path */
  getFile(projectId: string, path: string): Promise<string | null>;
  /** Apply a set of changes atomically and create a new snapshot */
  applyChanges(
    projectId: string,
    changes: FileChange[],
    message: string,
    createdById?: string,
  ): Promise<{ snapshotId: string; versionNumber: number }>;
}

// ─── Structured tool output (versioned) ───────────────────

export const TOOL_OUTPUT_VERSION = 1;

export interface ToolOutput {
  version: typeof TOOL_OUTPUT_VERSION;
  message: string;
  changes: Array<{
    path: string;
    operation: 'write' | 'delete' | 'ask_user';
    content?: string;
  }>;
  diagnostics?: Diagnostic[];
}
