import type { ProviderCompleteOptions } from '@app-builder/ai-gateway';
import type { AIProvider } from '@app-builder/shared';
import { parseAgentAction, type AgentAction } from '@/lib/agent-protocol';

export const NATIVE_TOOL_PROVIDERS: ReadonlySet<AIProvider> = new Set([
  'openai',
  'groq',
  'mistral',
  'custom',
]);

export function nativeToolsEnabled(provider: AIProvider): boolean {
  if (process.env.SOVEREIGN_NATIVE_TOOLS === '0') return false;
  return NATIVE_TOOL_PROVIDERS.has(provider);
}

export const SOVEREIGN_TOOLS: NonNullable<ProviderCompleteOptions['tools']> = [
  {
    type: 'function',
    function: {
      name: 'read_files',
      description:
        'Read project files. At most 12 requests. Paths are relative; optional 1-indexed startLine/endLine.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                startLine: { type: 'integer', minimum: 1 },
                endLine: { type: 'integer', minimum: 1 },
              },
              required: ['path'],
            },
          },
        },
        required: ['files'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or replace a file with its complete contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace one unique occurrence of search with replace in a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          search: { type: 'string' },
          replace: { type: 'string' },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a project file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_questions',
      description: 'Ask the user up to 3 multiple-choice questions before continuing.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' }, minItems: 3 },
              },
              required: ['question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_images',
      description: 'Generate images for the project. At most 8 specs per call.',
      parameters: {
        type: 'object',
        properties: {
          images: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                prompt: { type: 'string' },
                semanticUse: { type: 'string' },
                placeholderToken: { type: 'string' },
              },
              required: ['prompt', 'semanticUse', 'placeholderToken'],
            },
          },
        },
        required: ['images'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_design_directions',
      description: 'Propose exactly 3 visual directions for an empty project. Do not mutate files in the same turn.',
      parameters: {
        type: 'object',
        properties: {
          directions: { type: 'array', minItems: 3, maxItems: 3 },
        },
        required: ['directions'],
      },
    },
  },
];

export function parseToolCallAction(name: string, rawArguments: string): AgentAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || '{}') as unknown;
  } catch {
    throw new Error(`Tool ${name} arguments are not valid JSON`);
  }
  const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  return parseAgentAction(JSON.stringify({ type: name, ...body }));
}

export function actionsFromToolCalls(
  calls: { id: string; function: { name: string; arguments: string } }[],
): AgentAction {
  const actions = calls.map((call) => parseToolCallAction(call.function.name, call.function.arguments));
  if (actions.length === 1) return actions[0]!;
  // Each child comes from a single tool call, so it is never a nested batch.
  return { type: 'batch', actions: actions as Array<Exclude<AgentAction, { type: 'batch' }>> };
}

export function getStreamingFileFromToolCalls(
  calls: { function: { name: string; arguments: string } }[],
): { type: 'write_file'; path: string; content: string } | { type: 'edit_file'; path: string; search: string; replace: string } | null {
  for (const call of calls) {
    const name = call.function.name;
    const args = call.function.arguments;
    if (name === 'write_file') {
      const path = extractJsonString(args, 'path');
      const content = extractJsonString(args, 'content');
      if (path && content !== null) return { type: 'write_file', path, content };
    }
    if (name === 'edit_file') {
      const path = extractJsonString(args, 'path');
      const search = extractJsonString(args, 'search');
      const replace = extractJsonString(args, 'replace');
      if (path && search !== null && replace !== null) {
        return { type: 'edit_file', path, search, replace };
      }
    }
  }
  return null;
}

function extractJsonString(source: string, key: string): string | null {
  try {
    const parsed = JSON.parse(source) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>)[key] === 'string') {
      return (parsed as Record<string, string>)[key]!;
    }
  } catch {
    const match = source.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (match?.[1] !== undefined) {
      return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  return null;
}
