// Code Generation Engine — pure stages, no in-memory state
//
// Pipeline: buildContext → parseResponse → normalizePaths → validate → computeChanges → (apply via repository)

import type {
  EngineConfig,
  FileChange,
  GenerationResult,
  SystemPromptContext,
  SnapshotRepository,
  ToolOutput,
  Diagnostic,
} from './types';

// ─── Stage 1: Build context from snapshot ─────────────────

export function buildContext(params: {
  manifest: Record<string, string>;
  files: { path: string; content: string }[];
  requirements: string;
  projectName: string;
  projectDescription?: string;
  config: EngineConfig;
}): SystemPromptContext {
  return {
    manifest: params.manifest,
    relevantFiles: params.files,
    userRequirements: params.requirements,
    projectSettings: {
      name: params.projectName,
      description: params.projectDescription,
      techStack: params.config.techStack,
    },
    budget: {
      maxInputTokens: params.config.maxTokens ?? 128000,
      maxOutputFiles: 50,
      maxOutputBytes: 5 * 1024 * 1024, // 5 MB
    },
  };
}

// ─── Stage 2: Parse structured tool output ────────────────

export function parseResponse(rawResponse: string): ToolOutput {
  // Try to extract JSON from markdown code blocks first
  const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch?.[1] ?? rawResponse.trim();

  try {
    const parsed = JSON.parse(jsonStr) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Response is not an object');
    }

    const obj = parsed as Record<string, unknown>;

    // Validate required fields
    if (typeof obj.message !== 'string') {
      throw new Error('Missing or invalid "message" field');
    }
    if (!Array.isArray(obj.changes)) {
      throw new Error('Missing or invalid "changes" array');
    }

    // Validate each change
    const changes = (obj.changes as unknown[]).map((c, i) => {
      if (!c || typeof c !== 'object') {
        throw new Error(`Change ${i} is not an object`);
      }
      const change = c as Record<string, unknown>;
      if (typeof change.path !== 'string') {
        throw new Error(`Change ${i} missing "path"`);
      }
      if (!['write', 'delete', 'ask_user'].includes(change.operation as string)) {
        throw new Error(`Change ${i} has invalid operation: ${change.operation}`);
      }
      return {
        path: change.path as string,
        operation: change.operation as 'write' | 'delete' | 'ask_user',
        content: typeof change.content === 'string' ? change.content : undefined,
      };
    });

    return {
      version: 1,
      message: obj.message as string,
      changes,
      diagnostics: Array.isArray(obj.diagnostics) ? (obj.diagnostics as Diagnostic[]) : [],
    };
  } catch (e) {
    throw new Error(
      `Failed to parse AI response: ${e instanceof Error ? e.message : 'Unknown error'}`,
    );
  }
}

// ─── Stage 3: Normalize paths ─────────────────────────────

const DANGEROUS_PATH_PATTERNS = [
  /\.\./, // parent directory traversal
  /\0/, // NUL byte
  /\\/, // backslash
  /^\//, // absolute path
  /^[a-zA-Z]:/, // Windows drive-letter absolute path (e.g. C:/ or D:\)
];

export function normalizePath(path: string): string {
  // Normalize separators
  let normalized = path.replace(/\\/g, '/');

  // Remove leading ./
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  // Remove trailing slashes
  while (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function validatePath(path: string): string | null {
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATH_PATTERNS) {
    if (pattern.test(path)) {
      return null; // Invalid path
    }
  }

  // Check for duplicate normalized paths (handled at caller level)
  // Check file size limits (handled at caller level)

  return normalizePath(path);
}

// ─── Stage 4: Validate files ──────────────────────────────

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

export function validateChanges(
  changes: ToolOutput['changes'],
  _manifest: Record<string, string>,
  budget: SystemPromptContext['budget'],
): { valid: FileChange[]; diagnostics: Diagnostic[] } {
  const valid: FileChange[] = [];
  const diagnostics: Diagnostic[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;

  for (const change of changes) {
    const normalizedPath = validatePath(change.path);
    if (normalizedPath && seenPaths.has(normalizedPath)) {
      diagnostics.push({
        file: change.path,
        severity: 'error',
        message: `Duplicate file path: ${change.path} (normalized: ${normalizedPath})`,
      });
      continue;
    }
    if (normalizedPath) seenPaths.add(normalizedPath);

    if (!normalizedPath) {
      diagnostics.push({
        file: change.path,
        severity: 'error',
        message: `Invalid file path: ${change.path}`,
      });
      continue;
    }

    if (change.operation === 'write' && change.content !== undefined) {
      const contentBytes = new TextEncoder().encode(change.content).length;

      if (contentBytes > MAX_FILE_SIZE) {
        diagnostics.push({
          file: normalizedPath,
          severity: 'error',
          message: `File exceeds 1 MB limit (${contentBytes} bytes)`,
        });
        continue;
      }

      totalBytes += contentBytes;

      if (totalBytes > budget.maxOutputBytes) {
        diagnostics.push({
          file: normalizedPath,
          severity: 'error',
          message: `Total output size exceeds ${budget.maxOutputBytes} byte budget`,
        });
        break;
      }
    }

    if (valid.length >= budget.maxOutputFiles) {
      diagnostics.push({
        file: normalizedPath,
        severity: 'error',
        message: `Output file limit (${budget.maxOutputFiles}) reached`,
      });
      break;
    }

    if (change.operation === 'ask_user') {
      continue;
    }

    const isExisting = _manifest != null && Object.hasOwn(_manifest, normalizedPath);
    const operation: FileChange['operation'] =
      change.operation === 'delete'
        ? 'DELETE'
        : isExisting
          ? 'UPDATE'
          : 'CREATE';

    valid.push({
      path: normalizedPath,
      operation,
      content: change.content,
    });
  }

  return { valid, diagnostics };
}

// ─── Stage 5: Build system prompt ─────────────────────────

export function buildSystemPrompt(context: SystemPromptContext): string {
  const fileList = Object.entries(context.manifest)
    .map(([path, hash]) => `${path} (${hash.slice(0, 8)})`)
    .join('\n');

  const fileContents = context.relevantFiles
    .map((f) => `\n--- ${f.path} ---\n${f.content}`)
    .join('\n');

  return `You are an expert ${context.projectSettings.techStack.framework} developer.

Project: ${context.projectSettings.name}
${context.projectSettings.description ? `Description: ${context.projectSettings.description}` : ''}

Tech Stack:
- Framework: ${context.projectSettings.techStack.framework}
- Language: ${context.projectSettings.techStack.language}
- Styling: ${context.projectSettings.techStack.styling}
- Components: ${context.projectSettings.techStack.components}
- Bundler: ${context.projectSettings.techStack.bundler}

Current File Manifest:
${fileList || '(empty project)'}

Relevant Files:
${fileContents || '(none)'}

Budget:
- Max output files: ${context.budget.maxOutputFiles}
- Max output bytes: ${context.budget.maxOutputBytes}

Respond with a JSON object in a markdown code block:
\`\`\`json
{
  "message": "Description of what you changed",
  "changes": [
    { "path": "src/App.tsx", "operation": "write", "content": "..." },
    { "path": "src/old-file.ts", "operation": "delete" }
  ],
  "diagnostics": []
}
\`\`\`

Rules:
- Use "write" to create or overwrite files
- Use "delete" to remove files
- Paths must be relative, no leading ./ or ../
- Content must be complete file contents, not patches
- No absolute paths, no NUL bytes, no backslashes`;
}

// ─── Public API: full pipeline ────────────────────────────

export async function generate(params: {
  rawResponse: string;
  manifest: Record<string, string>;
  config: EngineConfig;
  repo?: SnapshotRepository;
  projectId?: string;
  message?: string;
  createdById?: string;
}): Promise<GenerationResult> {
  // 1. Parse structured output
  const toolOutput = parseResponse(params.rawResponse);

  // 2. Validate and normalize changes
  const systemPromptContext = buildContext({
    manifest: params.manifest,
    files: [],
    requirements: '',
    projectName: '',
    config: params.config,
  });

  const { valid: changes, diagnostics } = validateChanges(
    toolOutput.changes,
    params.manifest,
    systemPromptContext.budget,
  );

  // 3. Apply via repository if provided (transactional)
  if (params.repo && params.projectId) {
    const fatalErrors = diagnostics.filter((d) => d.severity === 'error');
    if (fatalErrors.length === 0 && changes.length > 0) {
      await params.repo.applyChanges(
        params.projectId,
        changes,
        params.message ?? toolOutput.message,
        params.createdById,
      );
    }
  }

  return {
    message: toolOutput.message,
    changes,
    diagnostics,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: diagnostics.some((d) => d.severity === 'error') ? 'failed' : 'complete',
  };
}
