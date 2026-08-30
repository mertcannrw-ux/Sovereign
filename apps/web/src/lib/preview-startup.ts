import {
  AXE_RUNTIME_SCRIPT,
  instrumentPreviewHtml,
  VISUAL_EDITOR_SCRIPT,
} from '@/lib/visual-editor';

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

const PREVIEW_ASSET_URL_PATTERN = /https?:\/\/[^'"`\s),\]]+\/api\/assets\/[^'"`\s),\]]+/g;

/** Finds local builder asset URLs that cannot be fetched from an HTTPS preview iframe. */
export function getPreviewAssetUrls(content: string): string[] {
  return [...new Set(content.match(PREVIEW_ASSET_URL_PATTERN) ?? [])];
}

/** Replaces only URLs that were successfully materialized into the preview filesystem. */
export function replacePreviewAssetUrls(
  content: string,
  replacements: ReadonlyMap<string, string>,
): string {
  let result = content;
  for (const [source, target] of replacements) {
    result = result.split(source).join(target);
  }
  return result;
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

export const STATIC_PREVIEW_COMMAND = { command: 'node', args: ['.sovereign-preview.mjs'] } as const;
export const VITE_INSTALL_COMMAND = { command: 'npm', args: ['install', '--ignore-scripts'] } as const;
export const VITE_DEV_COMMAND = { command: 'npx', args: ['vite', '--host'] } as const;

export type PreviewEngine = 'static' | 'vite';

export interface PreviewProcess {
  exit: Promise<number>;
  output: ReadableStream<string> | ReadableStream<Uint8Array>;
  kill: () => void;
}

export interface PreviewProcessHost {
  spawn: (command: string, args: string[]) => Promise<PreviewProcess>;
}

export interface PreviewEventSource {
  on(event: 'error', listener: (error: { message: string }) => void): unknown;
  on(
    event: 'preview-message',
    listener: (message: { type?: string; message?: string; stack?: string }) => void,
  ): unknown;
}

/** Flag defaults off. Only `'1'` enables Vite-in-WebContainer. */
export function isVitePreviewEnabled(
  env: Record<string, string | undefined> = {
    SOVEREIGN_VITE_PREVIEW: process.env.SOVEREIGN_VITE_PREVIEW,
    NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW: process.env.NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW,
  },
): boolean {
  return env.SOVEREIGN_VITE_PREVIEW === '1' || env.NEXT_PUBLIC_SOVEREIGN_VITE_PREVIEW === '1';
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
    normalized === '.sovereign-edit.js' ||
    normalized === '.sovereign-preview.mjs' ||
    normalized.startsWith('.sovereign/') ||
    normalized.startsWith('public/.sovereign')
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
          const editScript = '<script src="/.sovereign-edit.js"></script>';
          const instrumented = html.includes('/.sovereign-edit.js')
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
  return [
    { path: '.sovereign-edit.js', content: VISUAL_EDITOR_SCRIPT },
    { path: '.sovereign/axe.js', content: AXE_RUNTIME_SCRIPT },
    { path: '.sovereign-preview.mjs', content: STATIC_PREVIEW_SERVER_SOURCE },
  ];
}

export function formatForwardedPreviewError(message: {
  type?: string;
  message?: string;
  stack?: string;
}): string {
  const kind = message.type ?? 'exception';
  const body = [message.message, message.stack].filter(Boolean).join('\n');
  return `[preview ${kind}] ${body}`.trim();
}

export function formatContainerError(error: { message: string }): string {
  return `[webcontainer] ${error.message}`;
}

export function subscribePreviewDiagnostics(
  container: PreviewEventSource,
  onLog: (line: string) => void,
  onContainerError?: (message: string) => void,
): void {
  container.on('error', (error) => {
    onLog(formatContainerError(error));
    onContainerError?.(error.message);
  });
  container.on('preview-message', (message) => {
    onLog(formatForwardedPreviewError(message));
  });
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

export interface StartPreviewProcessResult {
  process: PreviewProcess;
  engine: PreviewEngine;
  fallbackError?: string;
}

async function startStaticPreview(
  host: PreviewProcessHost,
  onLog: (line: string) => void,
): Promise<PreviewProcess> {
  const server = await host.spawn(STATIC_PREVIEW_COMMAND.command, [...STATIC_PREVIEW_COMMAND.args]);
  attachProcessOutput(server, onLog);
  return server;
}

async function startVitePreview(
  host: PreviewProcessHost,
  onLog: (line: string) => void,
  installTimeoutMs: number,
): Promise<PreviewProcess> {
  onLog('Installing preview dependencies (npm install --ignore-scripts)…');
  const install = await host.spawn(VITE_INSTALL_COMMAND.command, [...VITE_INSTALL_COMMAND.args]);
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
  if (installCode !== 0) {
    throw new Error(`npm install --ignore-scripts failed (exit ${installCode})`);
  }

  onLog('Starting Vite (`npx vite --host`)…');
  const vite = await host.spawn(VITE_DEV_COMMAND.command, [...VITE_DEV_COMMAND.args]);
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
  },
): Promise<StartPreviewProcessResult> {
  if (options.mode !== 'vite') {
    return { process: await startStaticPreview(host, options.onLog), engine: 'static' };
  }

  try {
    const process = await startVitePreview(
      host,
      options.onLog,
      options.installTimeoutMs ?? NPM_INSTALL_TIMEOUT_MS,
    );
    return { process, engine: 'vite' };
  } catch (error) {
    const fallbackError = error instanceof Error ? error.message : 'Vite boot failed';
    options.onLog(
      `Vite preview failed: ${fallbackError}. Falling back to the static file server.`,
    );
    const process = await startStaticPreview(host, options.onLog);
    return { process, engine: 'static', fallbackError };
  }
}
