import { describe, expect, it } from 'vitest';
import {
  RUNTIME_COMMANDS,
  RUNTIME_COMMAND_NAMES,
  RUNTIME_OUTPUT_MAX_CHARS,
  formatRuntimeObservation,
  resolveRuntimeCommand,
  sanitizePreviewErrors,
  truncateRuntimeOutput,
} from '@/lib/runtime-commands';

describe('resolveRuntimeCommand', () => {
  it('resolves every allowlisted command to its argv', () => {
    expect(resolveRuntimeCommand('npm install')).toEqual({
      command: 'npm install',
      argv: ['npm', 'install'],
      timeoutMs: 180_000,
    });
    expect(resolveRuntimeCommand('npx tsc --noEmit')?.argv).toEqual(['npx', 'tsc', '--noEmit']);
    expect(resolveRuntimeCommand('npx vite build')?.argv).toEqual(['npx', 'vite', 'build']);
    expect(RUNTIME_COMMAND_NAMES).toEqual(['npm install', 'npx tsc --noEmit', 'npx vite build']);
  });

  it('normalizes whitespace but nothing else', () => {
    expect(resolveRuntimeCommand('  npx   tsc    --noEmit  ')?.command).toBe('npx tsc --noEmit');
  });

  it('refuses anything off the allowlist, including lookalikes and chaining', () => {
    const rejected = [
      '',
      'npm',
      'npm install --ignore-scripts',
      'npm install lodash',
      'npm run build',
      'npx tsc',
      'npx tsc --noEmit && rm -rf /',
      'npx tsc --noEmit; rm -rf /',
      'npx tsc --noEmit | tee out',
      'node -e "process.exit(1)"',
      'vite build',
      // Prototype keys must not resolve through the Record lookup.
      'constructor',
      '__proto__',
      'toString',
    ];
    for (const command of rejected) {
      expect(resolveRuntimeCommand(command), command).toBeNull();
    }
  });

  it('keeps the lookup table static and complete', () => {
    expect(Object.keys(RUNTIME_COMMANDS)).toEqual([...RUNTIME_COMMAND_NAMES]);
  });
});

describe('truncateRuntimeOutput', () => {
  it('returns short output unchanged', () => {
    expect(truncateRuntimeOutput('ok', 100)).toBe('ok');
  });

  it('keeps the head and the tail of long output with an omission marker', () => {
    const output = `START${'x'.repeat(10_000)}END`;
    const truncated = truncateRuntimeOutput(output, 100);
    expect(truncated.startsWith('START')).toBe(true);
    expect(truncated.endsWith('END')).toBe(true);
    expect(truncated).toContain('characters omitted');
    expect(truncated.length).toBeLessThanOrEqual(100);
  });

  it('applies the shared cap by default', () => {
    const truncated = truncateRuntimeOutput('y'.repeat(RUNTIME_OUTPUT_MAX_CHARS + 500));
    expect(truncated.length).toBeLessThanOrEqual(RUNTIME_OUTPUT_MAX_CHARS);
    expect(truncated).toContain('characters omitted');
  });
});

describe('sanitizePreviewErrors', () => {
  it('keeps bounded, deduplicated, one-line strings', () => {
    const errors = sanitizePreviewErrors([
      'Error: boom\n  at App',
      'Error: boom\n  at App',
      '',
      42,
      null,
      'Warning: keys',
    ]);
    expect(errors).toEqual(['Error: boom at App', 'Warning: keys']);
  });

  it('caps the number of errors and their length', () => {
    const many = sanitizePreviewErrors(
      Array.from({ length: 30 }, (_, index) => `error-${index}-${'z'.repeat(2_000)}`),
    );
    expect(many).toHaveLength(8);
    expect(many[0]!.length).toBeLessThanOrEqual(600);
  });

  it('returns an empty list for non-array input', () => {
    expect(sanitizePreviewErrors(undefined)).toEqual([]);
    expect(sanitizePreviewErrors('boom')).toEqual([]);
  });
});

describe('formatRuntimeObservation', () => {
  it('reports the exit code, duration and output of a finished command', () => {
    const observation = formatRuntimeObservation('npx tsc --noEmit', {
      status: 'complete',
      output: 'src/App.tsx(3,5): error TS2304: Cannot find name x.',
      exitCode: 2,
      durationMs: 8_400,
    });
    expect(observation).toContain('`npx tsc --noEmit` exited with code 2 in 8.4s.');
    expect(observation).toContain('Cannot find name x.');
    expect(observation).not.toContain('run error');
  });

  it('marks an empty output explicitly', () => {
    expect(
      formatRuntimeObservation('npm install', {
        status: 'complete',
        output: '   ',
        exitCode: 0,
        durationMs: 1_000,
      }),
    ).toContain('(no output)');
  });

  it('reports a command that never ran as an error, not a compile failure', () => {
    const observation = formatRuntimeObservation('npx vite build', {
      status: 'failed',
      output: '',
      exitCode: null,
      durationMs: 0,
      error: 'no WebContainer',
    });
    expect(observation).toContain(
      'run error: `npx vite build` did not complete — no WebContainer.',
    );
  });

  it('attaches preview console errors captured during the run', () => {
    const observation = formatRuntimeObservation('npx vite build', {
      status: 'complete',
      output: 'built in 2s',
      exitCode: 0,
      durationMs: 2_000,
      consoleErrors: ['[preview PREVIEW_UNCAUGHT_EXCEPTION] boom'],
    });
    expect(observation).toContain('Preview console errors while the command ran:');
    expect(observation).toContain('- [preview PREVIEW_UNCAUGHT_EXCEPTION] boom');
  });
});
