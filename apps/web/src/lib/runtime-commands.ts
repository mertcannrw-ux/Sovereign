/**
 * Static allowlist keyed by the exact canonical command string. A command is
 * an exact string match: there is no shell — no `;`, `&&`, pipes, flags or
 * package arguments can slip through, and an unknown key resolves to null.
 */
export interface RuntimeCommandSpec {
  /** argv[0] and args, passed verbatim to `WebContainer.spawn`. */
  argv: readonly string[];
  /** Wall-clock budget before the client kills the process. */
  timeoutMs: number;
}

export const RUNTIME_COMMANDS: Record<string, RuntimeCommandSpec> = {
  'npm install': {
    argv: ['npm', 'install'],
    timeoutMs: 180_000,
  },
  'npx tsc --noEmit': {
    argv: ['npx', 'tsc', '--noEmit'],
    timeoutMs: 120_000,
  },
  'npx vite build': {
    argv: ['npx', 'vite', 'build'],
    timeoutMs: 180_000,
  },
};

export const RUNTIME_COMMAND_NAMES: readonly string[] = Object.keys(RUNTIME_COMMANDS);

/** The canonical command and its argv for a model-supplied command string. */
export interface ResolvedRuntimeCommand extends RuntimeCommandSpec {
  command: string;
}

/**
 * Resolve a model-supplied command string to its allowlisted argv.
 * Whitespace is normalized (`npm   install` → `npm install`) and nothing else:
 * quotes, extra flags and chained commands never match.
 */
export function resolveRuntimeCommand(command: string): ResolvedRuntimeCommand | null {
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!normalized || !Object.hasOwn(RUNTIME_COMMANDS, normalized)) return null;
  const spec = RUNTIME_COMMANDS[normalized]!;
  return { command: normalized, argv: spec.argv, timeoutMs: spec.timeoutMs };
}

/** Cap on merged stdout+stderr returned to the model and kept in a trace row. */
export const RUNTIME_OUTPUT_MAX_CHARS = 8_000;

/**
 * Head-and-tail truncation: build errors are printed at the end of the log and
 * the command line at the beginning, so both survive the cap. The marker is
 * part of the cap — the result never exceeds `maxChars`.
 */
export function truncateRuntimeOutput(
  output: string,
  maxChars: number = RUNTIME_OUTPUT_MAX_CHARS,
): string {
  if (output.length <= maxChars) return output;
  const markerFor = (omitted: number) => `\n… [${omitted} characters omitted] …\n`;
  if (markerFor(output.length).length >= maxChars) return output.slice(0, maxChars);
  // The marker's length depends on the omitted count, and the omitted count on
  // the budget the marker leaves. The estimate uses the longest possible count,
  // so the second pass is exact (the budget can only grow).
  const estimate = maxChars - markerFor(output.length).length;
  const budget = maxChars - markerFor(output.length - estimate).length;
  const head = Math.max(0, Math.ceil(budget * 0.6));
  const tail = Math.max(0, budget - head);
  return `${output.slice(0, head)}${markerFor(output.length - budget)}${output.slice(
    output.length - tail,
  )}`;
}

/** Cap on preview console errors attached to a run result or a turn. */
export const MAX_PREVIEW_ERRORS = 8;

/** Cap on the length of a single preview console error line. */
export const MAX_PREVIEW_ERROR_CHARS = 600;

/** Bounded, de-duplicated copy of the client's preview console error ring. */
export function sanitizePreviewErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const line = item.replace(/\s+/g, ' ').trim().slice(0, MAX_PREVIEW_ERROR_CHARS);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    errors.push(line);
    if (errors.length >= MAX_PREVIEW_ERRORS) break;
  }
  return errors;
}

/** What one executed command returns, before it is posted to the server. */
export interface RuntimeCommandExecution {
  /** Merged stdout+stderr (WebContainer exposes a single terminal stream). */
  output: string;
  /** Exit code, or null when the process was killed or never exited. */
  exitCode: number | null;
  durationMs: number;
  /** Set when the command could not run or was killed (timeout). */
  error?: string;
}

/**
 * The result the client posts back for one `run` request. `status: 'complete'`
 * means the process ran (whatever its exit code); `'failed'` means the
 * sandbox could not run it (no container, spawn error, killed on timeout).
 */
export interface RuntimeCommandResult extends RuntimeCommandExecution {
  status: 'complete' | 'failed';
  /** Preview console errors observed while the command ran. */
  consoleErrors?: string[];
}

export const MAX_RUNTIME_OUTPUT_BYTES = 64_000;
export const MAX_RUNTIME_ERROR_CHARS = 2_000;

/**
 * Model-facing text for one `run` tool result. Exit code and output are the
 * whole point of the tool: the agent must be able to tell "compiles" from
 * "does not compile" without reading prose, and must see the tail of a build
 * log where the errors are.
 */
export function formatRuntimeObservation(command: string, result: RuntimeCommandResult): string {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const lines: string[] = [];
  if (result.status === 'failed') {
    lines.push(
      `run error: \`${command}\` did not complete${result.error ? ` — ${result.error}` : ''}.`,
    );
  } else {
    lines.push(
      `run result: \`${command}\` exited with code ${result.exitCode ?? 'unknown'} in ${seconds}s.`,
    );
  }
  lines.push('Output:', result.output.trim() || '(no output)');
  if (result.consoleErrors && result.consoleErrors.length > 0) {
    lines.push(
      'Preview console errors while the command ran:',
      ...result.consoleErrors.map((line) => `- ${line}`),
    );
  }
  return lines.join('\n');
}
