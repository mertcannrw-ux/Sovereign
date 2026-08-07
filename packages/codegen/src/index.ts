// Code generation engine — transforms AI output into valid project files
// Pure stages: parse → normalize → validate → compute changes → apply via repository

export {
  buildContext,
  parseResponse,
  normalizePath,
  validatePath,
  validateChanges,
  buildSystemPrompt,
  generate,
} from './engine';
export type {
  FileChange,
  Diagnostic,
  TokenUsage,
  FinishReason,
  GenerationResult,
  EngineConfig,
  SystemPromptContext,
  SnapshotRepository,
  ToolOutput,
} from './types';
