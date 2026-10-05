import {
  AXE_RUNTIME_SCRIPT,
  instrumentPreviewHtml,
  VISUAL_EDITOR_SCRIPT,
} from '@/lib/visual-editor';
import { getPreviewAssetUrls, replacePreviewAssetUrls } from '@app-builder/codegen';

export { getPreviewAssetUrls, replacePreviewAssetUrls };

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface PreviewSourceFile {
  path: string;
  content: string;
}

/** Merges boot layers while preserving the first (project-owned) file at each path. */
export function mergePreviewFiles(...groups: PreviewSourceFile[][]): PreviewSourceFile[] {
  const files = new Map<string, PreviewSourceFile>();
  for (const group of groups) {
    for (const file of group) {
      if (!files.has(file.path)) files.set(file.path, file);
    }
  }
  return [...files.values()];
}

export function getPreviewSupportFiles(files: PreviewSourceFile[]): PreviewSourceFile[] {
  const paths = new Set(files.map((file) => file.path.toLowerCase()));
  const hasReactTypescript = files.some((file) => /\.tsx$/i.test(file.path));
  const hasTypeScriptConfig = [...paths].some((path) =>
    /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(path),
  );

  if (!hasReactTypescript || hasTypeScriptConfig) return [];
  return [
    {
      path: 'tsconfig.json',
      content: JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }, null, 2),
    },
  ];
}

export const PREVIEW_JS_DISCLOSURE =
  'Preview runs project JavaScript — including `npm` packages — on this machine, inside an isolated iframe. Do not open projects you do not trust.';

export const NPM_INSTALL_TIMEOUT_MS = 60_000;
export const VITE_READY_TIMEOUT_MS = 30_000;

export const STATIC_PREVIEW_COMMAND = {
  command: 'node',
  args: ['.sovereign-preview.mjs'],
} as const;
export const VITE_INSTALL_COMMAND = {
  command: 'npm',
  args: ['install', '--ignore-scripts'],
} as const;
export const VITE_DEV_COMMAND = { command: 'npx', args: ['vite', '--host'] } as const;
/**
 * Vite's actual CLI entry. `npx` re-resolves the package on every boot (and may
 * consult the registry); spawning this through `node` skips that. Used only
 * when {@link PreviewProcessHost.exists} confirms the shim is present, so a
 * missing entry never silently downgrades the preview — we fall back to `npx`.
 */
export const VITE_DIRECT_ENTRY_PATH = 'node_modules/vite/bin/vite.js';
export const VITE_DIRECT_PREVIEW_COMMAND = {
  command: 'node',
  args: [VITE_DIRECT_ENTRY_PATH, '--host'],
} as const;
/**
 * Container-side marker recording the `package.json` content for which
 * `npm install` last exited 0 in this container instance. Under
 * {@link isSovereignOverlayPath}, so project-tree reconciliation never deletes
 * it; a reset container starts with a fresh filesystem and no stamp.
 */
export const VITE_INSTALL_STAMP_PATH = '.sovereign/npm-stamp';

export type PreviewEngine = 'static' | 'vite';

export interface PreviewProcess {
  exit: Promise<number>;
  output: ReadableStream<string> | ReadableStream<Uint8Array>;
  kill: () => void;
}

/**
 * Thrown when a preview boot was abandoned because its owner went away (page
 * unmount, project switch, retry). Callers must treat it as terminal silence —
 * never as a preview failure — and must leave the shared container alone: the
 * container is reused by the next project's preview, so a dead boot that keeps
 * going would spawn a server nobody owns (which the next preview then adopts as
 * its own) and tear down a sandbox another page is using.
 */
export class PreviewBootCancelledError extends Error {
  constructor() {
    super('Preview boot cancelled');
    this.name = 'PreviewBootCancelledError';
  }
}

function throwIfCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) throw new PreviewBootCancelledError();
}

function killQuietly(process: PreviewProcess): void {
  try {
    process.kill();
  } catch {
    // Process may already have exited.
  }
}

export interface PreviewProcessHost {
  spawn: (command: string, args: string[]) => Promise<PreviewProcess>;
  /** Read a container file as UTF-8; resolves `null` for missing/unreadable files. */
  readFile?: (path: string) => Promise<string | null>;
  /** Write a container file, creating parent directories as needed. */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** Whether a container path exists. Used to gate the direct Vite entry. */
  exists?: (path: string) => Promise<boolean>;
}

export interface PreviewEventSource {
  on(event: 'error', listener: (error: { message: string }) => void): unknown;
  on(
    event: 'preview-message',
    listener: (message: {
      type?: string;
      message?: string;
      stack?: string;
      args?: unknown[];
    }) => void,
  ): unknown;
}

/**
 * Event source that can also deliver `server-ready`. Kept separate from
 * {@link PreviewEventSource} so existing callers/tests only need the two
 * diagnostics events they actually consume.
 */
export interface PreviewServerEventSource {
  on(event: 'server-ready', listener: (port: number, url: string) => void): unknown;
}

/**
 * Vite-in-WebContainer is ON by default: the agent builds Vite/React projects
 * (package.json + TSX), and the static file server cannot compile them — it
 * would serve `.tsx` as an opaque octet-stream and the preview would go blank.
 * Projects without a package.json still use the static server.
 *
 * Opt out with SOVEREIGN_VITE_PREVIEW=0 (or "false") to force the static
 * engine everywhere. `next.config.mjs` copies the server-side var onto
 * NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW so the client bundle (WC hooks) sees it.
 */
export function isVitePreviewEnabled(
  env: Record<string, string | undefined> = {
    SOVEREIGN_VITE_PREVIEW: process.env.SOVEREIGN_VITE_PREVIEW,
    NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: process.env.NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW,
  },
): boolean {
  const raw = env.NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW || env.SOVEREIGN_VITE_PREVIEW;
  if (raw === '0' || raw === 'false') return false;
  return true;
}

export function hasPackageJson(files: { path: string }[]): boolean {
  return files.some((file) => {
    const normalized = file.path.replace(/^\.?\//, '').toLowerCase();
    return normalized === 'package.json' || normalized.endsWith('/package.json');
  });
}

export function shouldBootVite(
  files: { path: string }[],
  env?: Record<string, string | undefined>,
): boolean {
  return isVitePreviewEnabled(env) && hasPackageJson(files);
}

export function isIndexHtmlPath(path: string): boolean {
  const normalized = path.replace(/^\.?\//, '').toLowerCase();
  return normalized === 'index.html' || normalized.endsWith('/index.html');
}

/** Overlay paths are WC-only and must never be upserted as ProjectFile rows. */
export function isSovereignOverlayPath(path: string): boolean {
  const normalized = path.replace(/^\.?\//, '');
  return (
    normalized === '__sovereign_edit.js' ||
    normalized === '__sovereign_axe.js' ||
    normalized === 'public/__sovereign_edit.js' ||
    normalized === 'public/__sovereign_axe.js' ||
    normalized === '.sovereign-edit.js' ||
    normalized === '.sovereign-preview.mjs' ||
    normalized.startsWith('.sovereign/') ||
    normalized.startsWith('public/.sovereign') ||
    normalized.startsWith('public/__sovereign')
  );
}

export function overlayPreviewFiles<T extends { path: string; content: string }>(
  files: T[],
  enabled = true,
): T[] {
  if (!enabled) return files;
  return files.map((file) =>
    isIndexHtmlPath(file.path) ? { ...file, content: instrumentPreviewHtml(file.content) } : file,
  );
}

export const STATIC_PREVIEW_SERVER_SOURCE = `import { createServer } from 'node:http';
import { readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};


function startServer(port) {
  const srv = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    try {
      let safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\\/+/, '');
      const decoded = decodeURIComponent(safePath.replace(/\\?.*$/, ''));
      const fullPath = normalize(join(ROOT, decoded));
      if (!fullPath.startsWith(ROOT)) { response.writeHead(403); response.end('Forbidden'); return; }
      readFile(fullPath, (err, body) => {
        if (err) { response.writeHead(404); response.end('Not found'); return; }
        const ext = extname(fullPath).toLowerCase();
        const contentType = MIME[ext] ?? 'application/octet-stream';
          const html = body.toString('utf8');
          const editScript = '<script src="/__sovereign_edit.js"></script>';
          const instrumented = html.includes('/__sovereign_edit.js')
            ? html
            : html.includes('</body>')
            ? html.replace('</body>', editScript + '</body>')
            : html + editScript;
        if (ext === '.html') {
          response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
          response.end(instrumented);
        } else {
          response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
          response.end(body);
        }
      });
    } catch { response.writeHead(500); response.end('Internal error'); }
  });

  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port !== 0) {
      startServer(0);
    } else {
      console.error('Preview server error:', err.message);
    }
  });

  srv.listen(port, '0.0.0.0', () => {
    console.log('Preview server listening on port', srv.address().port);
  });
}

startServer(4173);`;

export function getPreviewOverlayFiles(): PreviewSourceFile[] {
  // Non-dot paths so Vite/sirv will serve them. Root copy is for the static
  // fallback server; public/ copy is Vite's static asset root (`/__sovereign_*`).
  // `__sovereign_axe.js` is a real collector file, not axe-core min (too large
  // to vendor here). It reports `skipped` unless window.axe is present.
  return [
    { path: '__sovereign_edit.js', content: VISUAL_EDITOR_SCRIPT },
    { path: 'public/__sovereign_edit.js', content: VISUAL_EDITOR_SCRIPT },
    { path: '__sovereign_axe.js', content: AXE_RUNTIME_SCRIPT },
    { path: 'public/__sovereign_axe.js', content: AXE_RUNTIME_SCRIPT },
    { path: '.sovereign-preview.mjs', content: STATIC_PREVIEW_SERVER_SOURCE },
  ];
}

/**
 * Console errors (`PREVIEW_CONSOLE_ERROR`) arrive as `args` — `String(arg)` on
 * an object prints `[object Object]`, and React logs component stacks as
 * strings inside `args`, so each entry is described as precisely as possible.
 */
function formatPreviewArgs(args: unknown[] | undefined): string {
  if (!args || args.length === 0) return '';
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack ?? arg.message;
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg) ?? String(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

export function formatForwardedPreviewError(message: {
  type?: string;
  message?: string;
  stack?: string;
  args?: unknown[];
}): string {
  const kind = message.type ?? 'exception';
  const description = message.message ?? formatPreviewArgs(message.args);
  const body = [description, message.stack].filter(Boolean).join('\n');
  return `[preview ${kind}] ${body}`.trim();
}

export function formatContainerError(error: { message: string }): string {
  return `[webcontainer] ${error.message}`;
}

/**
 * Subscribe to container diagnostics and return an unsubscribe function.
 *
 * `onPreviewError` receives only forwarded preview messages (console errors,
 * unhandled rejections and uncaught exceptions from the preview iframe) —
 * these are the lines the agent loop is allowed to see. The returned teardown
 * matters: the WebContainer is a module-level singleton shared by every mount,
 * so listeners that outlive their hook instance keep writing into that
 * instance's dead `setState`. Without unsubscribing, a remount
 * (dashboard → project) leaks listeners and the preview stops recovering.
 */
export function subscribePreviewDiagnostics(
  container: PreviewEventSource,
  onLog: (line: string) => void,
  onContainerError?: (message: string) => void,
  onPreviewError?: (line: string) => void,
): () => void {
  const subscriptions = [
    container.on('error', (error) => {
      onLog(formatContainerError(error));
      onContainerError?.(error.message);
    }),
    container.on('preview-message', (message) => {
      const line = formatForwardedPreviewError(message);
      onLog(line);
      onPreviewError?.(line);
    }),
  ];
  return () => {
    for (const unsubscribe of subscriptions) {
      if (typeof unsubscribe === 'function') unsubscribe();
    }
  };
}

export function attachProcessOutput(process: PreviewProcess, onLog: (line: string) => void): void {
  const stream = process.output as ReadableStream<string | Uint8Array>;
  void stream
    .pipeTo(
      new WritableStream<string | Uint8Array>({
        write(chunk) {
          onLog(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
        },
      }),
    )
    .catch(() => {
      // Killed processes abort their output stream.
    });
}

async function rejectIfAlreadyExited(process: PreviewProcess, label: string): Promise<void> {
  let exitCode: number | 'pending' = 'pending';
  void process.exit.then((code) => {
    exitCode = code;
  });
  await Promise.resolve();
  if (exitCode !== 'pending' && exitCode !== 0) {
    throw new Error(`${label} exited with code ${exitCode}`);
  }
}

async function spawnVite(
  host: PreviewProcessHost,
  command: { command: string; args: readonly string[] },
  isCancelled?: () => boolean,
): Promise<PreviewProcess> {
  const vite = await host.spawn(command.command, [...command.args]);
  // Same orphan-server guard as every other spawn here: an owner that left
  // during the spawn must not leave a listener on 5173 for the next project.
  if (isCancelled?.()) {
    killQuietly(vite);
    throw new PreviewBootCancelledError();
  }
  return vite;
}

/** Watch a spawned Vite process until it is promoted, dies, or times out. */
export function scheduleViteReadyFallback(
  process: PreviewProcess,
  options: {
    timeoutMs?: number;
    isCurrent: () => boolean;
    onLog: (line: string) => void;
    onFallback: () => void;
  },
): () => void {
  let settled = false;
  const timeoutMs = options.timeoutMs ?? VITE_READY_TIMEOUT_MS;

  const finish = (reason: string, kill: boolean) => {
    if (settled || !options.isCurrent()) return;
    settled = true;
    clearTimeout(timer);
    if (kill) {
      try {
        process.kill();
      } catch {
        // Already exited.
      }
    }
    options.onLog(reason);
    options.onFallback();
  };

  const timer = setTimeout(() => {
    finish('Vite did not become ready in time. Falling back to the static file server.', true);
  }, timeoutMs);

  void process.exit.then((code) => {
    finish(
      `Vite exited with code ${code} before preview was ready. Falling back to the static file server.`,
      false,
    );
  });

  return () => {
    settled = true;
    clearTimeout(timer);
  };
}

export interface StartPreviewProcessResult {
  process: PreviewProcess;
  engine: PreviewEngine;
  fallbackError?: string;
  /** True when Vite failed and we reused a static server that was already serving. */
  reusedExisting?: boolean;
}

async function startStaticPreview(
  host: PreviewProcessHost,
  onLog: (line: string) => void,
  isCancelled?: () => boolean,
): Promise<PreviewProcess> {
  throwIfCancelled(isCancelled);
  const server = await host.spawn(STATIC_PREVIEW_COMMAND.command, [...STATIC_PREVIEW_COMMAND.args]);
  // The owner can go away between the check above and the spawn resolving. A
  // server outliving its page would keep serving this project's files to the
  // next project's preview, so kill it instead of adopting it.
  if (isCancelled?.()) {
    killQuietly(server);
    throw new PreviewBootCancelledError();
  }
  attachProcessOutput(server, onLog);
  return server;
}

async function startVitePreview(
  host: PreviewProcessHost,
  onLog: (line: string) => void,
  installTimeoutMs: number,
  isCancelled: (() => boolean) | undefined,
  packageJson: string | null | undefined,
): Promise<PreviewProcess> {
  throwIfCancelled(isCancelled);
  // `npm install` is the dominant cost of a Vite boot. WebContainer keeps a
  // live `node_modules` for the whole browser session, so the second boot of
  // a project (HMR-less reload, project switch, Retry) can reuse it wholesale
  // when nothing touched the dependency set: `npm install` only ever ran after
  // the project's current `package.json` was written, and anything that edits
  // those files through the app rewrites `package.json` byte-for-byte with
  // them, so an unchanged file means an unchanged dependency set.
  const stamp = host.readFile
    ? await host.readFile(VITE_INSTALL_STAMP_PATH).catch(() => null)
    : null;
  const stampMatches =
    packageJson != null && host.readFile != null && stamp !== null && stamp === packageJson;
  // The stamp proves only that some install for this exact content exited 0 —
  // it is never invalidated, so the tree it describes may since have been
  // deleted or left partial (a failed install that was then reverted, an
  // agent-issued `rm -rf node_modules`). Trusting it blindly would let `npx`
  // fetch a floating Vite on top of missing app dependencies, so probe the
  // installed entry before skipping.
  const skipInstall =
    stampMatches &&
    (host.exists == null || (await host.exists(VITE_DIRECT_ENTRY_PATH).catch(() => false)));
  if (skipInstall) {
    onLog('Skipping npm install: dependencies already installed for this package.json.');
  } else {
    onLog('Installing preview dependencies (npm install --ignore-scripts)…');
    const install = await host.spawn(VITE_INSTALL_COMMAND.command, [
      ...VITE_INSTALL_COMMAND.args,
    ]);
    if (isCancelled?.()) {
      killQuietly(install);
      throw new PreviewBootCancelledError();
    }
    attachProcessOutput(install, onLog);
    const installCode = await withTimeout(
      install.exit,
      installTimeoutMs,
      'npm install --ignore-scripts timed out',
      () => {
        try {
          install.kill();
        } catch {
          // Process may already have exited.
        }
      },
    );
    // npm install takes seconds; navigating away in that window is the common
    // case. Spawning Vite here anyway leaves an orphan listening on 5173 that
    // the *next* project's preview adopts as its own URL — the stale-preview
    // bug.
    throwIfCancelled(isCancelled);
    if (installCode !== 0) {
      throw new Error(`npm install --ignore-scripts failed (exit ${installCode})`);
    }
    if (packageJson != null && host.writeFile) {
      // Best-effort marker: a failed write only costs a redundant install
      // later, never correctness.
      await host.writeFile(VITE_INSTALL_STAMP_PATH, packageJson).catch(() => {});
    }
  }

  // `npx` re-resolves the package (occasionally against the registry) on every
  // boot. The install above guarantees Vite's own bin shim exists, so spawning
  // it directly is strictly cheaper. Anything unexpected about the entry — a
  // hand-edited `package.json` that skipped Vite, a half-deleted
  // `node_modules` — is re-checked with `npx` rather than downgrading the
  // preview to static: the static server cannot run TS React apps, so a
  // silently blank pane is the worst failure mode here.
  const hasDirectEntry = host.exists
    ? await host.exists(VITE_DIRECT_ENTRY_PATH).catch(() => false)
    : false;
  if (hasDirectEntry) {
    onLog(`Starting Vite (\`node ${VITE_DIRECT_ENTRY_PATH} --host\`)…`);
    try {
      const vite = await spawnVite(host, VITE_DIRECT_PREVIEW_COMMAND, isCancelled);
      attachProcessOutput(vite, onLog);
      await rejectIfAlreadyExited(vite, 'Vite');
      return vite;
    } catch (error) {
      if (error instanceof PreviewBootCancelledError) throw error;
      onLog(
        `Direct Vite entry failed (${error instanceof Error ? error.message : error}). Retrying with npx…`,
      );
    }
  }

  onLog('Starting Vite (`npx vite --host`)…');
  const vite = await spawnVite(host, VITE_DEV_COMMAND, isCancelled);
  attachProcessOutput(vite, onLog);
  await rejectIfAlreadyExited(vite, 'Vite');
  return vite;
}

export async function startPreviewProcess(
  host: PreviewProcessHost,
  options: {
    mode: PreviewEngine;
    onLog: (line: string) => void;
    installTimeoutMs?: number;
    /** Live static server already serving — reuse instead of spawning a second one. */
    existingStatic?: PreviewProcess | null;
    /** True once the caller no longer wants this preview (its page went away). */
    isCancelled?: () => boolean;
    /** The project's current `package.json` content, for the install stamp. */
    packageJson?: string | null;
  },
): Promise<StartPreviewProcessResult> {
  if (options.mode !== 'vite') {
    return {
      process: await startStaticPreview(host, options.onLog, options.isCancelled),
      engine: 'static',
    };
  }

  try {
    const process = await startVitePreview(
      host,
      options.onLog,
      options.installTimeoutMs ?? NPM_INSTALL_TIMEOUT_MS,
      options.isCancelled,
      options.packageJson,
    );
    return { process, engine: 'vite' };
  } catch (error) {
    // A cancelled boot is not a Vite failure: falling back would spawn the very
    // static server the caller no longer wants.
    if (error instanceof PreviewBootCancelledError) throw error;
    const fallbackError = error instanceof Error ? error.message : 'Vite boot failed';
    if (options.existingStatic) {
      options.onLog(`Vite preview failed: ${fallbackError}. Keeping the static file server.`);
      return {
        process: options.existingStatic,
        engine: 'static',
        fallbackError,
        reusedExisting: true,
      };
    }
    options.onLog(`Vite preview failed: ${fallbackError}. Falling back to the static file server.`);
    const process = await startStaticPreview(host, options.onLog, options.isCancelled);
    return { process, engine: 'static', fallbackError };
  }
}
