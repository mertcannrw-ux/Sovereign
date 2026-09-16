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
export { applyStackContract, isForbiddenEnvPath, REQUIRED_FILE_PATHS } from './contract';
export type {
  ApplyStackContractOptions,
  StackContractChange,
  StackContractResult,
  StackFileOperation,
} from './contract';
export { completePackageJson } from './dependency-complete';
export type { CompletePackageJsonResult, PackageJsonShape } from './dependency-complete';
export { repairJson, stringifyJson } from './json-repair';
export {
  FALLBACK_EXPORT,
  LUCIDE_EXPORTS,
  fileImportsLucide,
  resolveLucideExport,
  rewriteLucideSource,
} from './lucide-map';
export { getPreviewAssetUrls, replacePreviewAssetUrls } from './preview-assets';
export { sanitizeEnvExample, SEEDS } from './stack-seeds';
export { default as stackLock } from './stack-lock.json';
