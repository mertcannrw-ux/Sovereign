'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';

export interface PreviewFile {
  path: string;
  content: string;
}

interface SandboxState {
  status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'error';
  url: string | null;
  logs: string[];
  error: string | null;
}

let containerPromise: Promise<WebContainer> | null = null;

/** Module-level reference so a remount can kill the previous server. */
let previousBootServer: WebContainerProcess | null = null;

async function getContainer(): Promise<WebContainer> {
  if (!containerPromise) {
    containerPromise = import('@webcontainer/api').then(({ WebContainer }) =>
      WebContainer.boot({ coep: 'require-corp', forwardPreviewErrors: 'exceptions-only' }),
    );
  }
  return containerPromise;
}

async function ensureParentDirectories(container: WebContainer, path: string) {
  const parts = path.split('/').slice(0, -1);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await container.fs.mkdir(current);
    } catch {
      // Directory already exists.
    }
  }
}

export function useWebContainer(initialFiles: PreviewFile[], enabled = true) {
  const [state, setState] = useState<SandboxState>({
    status: 'idle',
    url: null,
    logs: [],
    error: null,
  });
  const serverRef = useRef<WebContainerProcess | null>(null);
  const bootedRef = useRef(false);
  const writeQueueRef = useRef(Promise.resolve());

  const appendLog = useCallback((line: string) => {
    setState((current) => ({ ...current, logs: [...current.logs.slice(-80), line] }));
  }, []);

  const writeFiles = useCallback((files: PreviewFile[]) => {
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      const container = await getContainer();
      await Promise.all(
        files.map(async (file) => {
          await ensureParentDirectories(container, file.path);
          await container.fs.writeFile(file.path, file.content);
        }),
      );
    });
    return writeQueueRef.current;
  }, []);

  const replaceFiles = useCallback((previousFiles: PreviewFile[], nextFiles: PreviewFile[]) => {
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      const container = await getContainer();
      const nextPaths = new Set(nextFiles.map((file) => file.path));
      await Promise.all(
        previousFiles
          .filter((file) => !nextPaths.has(file.path))
          .map((file) => container.fs.rm(file.path, { force: true })),
      );
      await Promise.all(
        nextFiles.map(async (file) => {
          await ensureParentDirectories(container, file.path);
          await container.fs.writeFile(file.path, file.content);
        }),
      );
    });
    return writeQueueRef.current;
  }, []);


  // Expose triggerRefresh that actually fetches the HMR endpoint once url is known
  const urlRef = useRef(state.url);
  urlRef.current = state.url;
  const doRefresh = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    const base = u.endsWith('/') ? u.slice(0, -1) : u;
    fetch(base + '/__sovereign_hmr/refresh', { method: 'POST', mode: 'cors' }).catch(() => {});
  }, []);

  const boot = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    // Kill any server process left over from a previous mount
    if (previousBootServer) {
      try { previousBootServer.kill(); } catch {}
      previousBootServer = null;
    }

    try {
      setState((current) => ({ ...current, status: 'booting', error: null }));
      const container = await getContainer();
      container.on('server-ready', (_port, url) => {
        setState((current) => ({ ...current, status: 'ready', url }));
      });
      container.on('error', (error) => {
        setState((current) => ({ ...current, status: 'error', error: error.message }));
      });

      await writeFiles(initialFiles);
      if (!initialFiles.some((file) => file.path === 'index.html')) {
        await writeFiles([
          {
            path: 'index.html',
            content:
              '<!doctype html><html><body style="font-family:system-ui;background:#090909;color:white;display:grid;place-items:center;min-height:100vh"><div>Describe what you want to build.</div></body></html>',
          },
        ]);
      }

      await writeFiles([
        {
          path: '.sovereign-edit.js',
          content: `(() => {
  const MESSAGE_SOURCE = 'sovereign-visual-editor';
  let enabled = false;
  let hovered = null;
  let selected = null;

  const style = document.createElement('style');
  style.textContent = '[data-sovereign-hovered]{outline:2px solid #a3e635!important;outline-offset:2px!important}[data-sovereign-selected]{outline:2px solid #a3e635!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(163,230,53,.22)!important}html[data-sovereign-edit-mode] *{cursor:crosshair!important}';
  document.head.appendChild(style);

  function clearHovered() {
    if (hovered) hovered.removeAttribute('data-sovereign-hovered');
    hovered = null;
  }

  function clearSelected() {
    if (selected) selected.removeAttribute('data-sovereign-selected');
    selected = null;
  }

  function cssPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += '#' + CSS.escape(current.id);
        parts.unshift(part);
        break;
      }
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
      current = current.parentElement;
    }
    return ['body'].concat(parts).join(' > ');
  }

  function describe(element) {
    const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className.slice(0, 400) : '',
      text,
      selector: cssPath(element),
      sourceFile: location.pathname === '/' ? 'index.html' : location.pathname.replace(/^\\//, ''),
      outerHTML: element.outerHTML.slice(0, 1200),
    };
  }

  document.addEventListener('pointermove', (event) => {
    if (!enabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target === hovered || target === document.documentElement || target === document.body) return;
    clearHovered();
    hovered = target;
    if (hovered !== selected) hovered.setAttribute('data-sovereign-hovered', '');
  }, true);

  document.addEventListener('pointerleave', clearHovered, true);
  document.addEventListener('click', (event) => {
    if (!enabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target === document.documentElement || target === document.body) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearHovered();
    clearSelected();
    selected = target;
    selected.setAttribute('data-sovereign-selected', '');
    window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'element-selected', element: describe(target) }, '*');
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!enabled || event.key !== 'Escape') return;
    clearHovered();
    clearSelected();
    window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'selection-cleared' }, '*');
  }, true);

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== MESSAGE_SOURCE || event.data.type !== 'set-edit-mode') return;
    enabled = Boolean(event.data.enabled);
    document.documentElement.toggleAttribute('data-sovereign-edit-mode', enabled);
    if (!enabled) {
      clearHovered();
      clearSelected();
    }
  });

  window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'ready' }, '*');
})();`,
        },
      ]);

      await writeFiles([
        {
          path: '.sovereign-preview.mjs',
          content: `import { createServer } from 'node:http';
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
          const instrumented = html.includes('</body>')
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

startServer(4173);`,
        },
      ]);

      setState((current) => ({ ...current, status: 'starting' }));
      const server = await container.spawn('node', ['.sovereign-preview.mjs']);
      previousBootServer = server;
      serverRef.current = server;
      // Swallow the pipe rejection: when this server process is killed (on the
      // next mount's previousBootServer.kill() or on unmount's serverRef.kill()),
      // its output stream is aborted and pipeTo rejects with "Process aborted".
      // Leaving it uncaught surfaces as an intermittent unhandledRejection.
      server.output.pipeTo(new WritableStream({ write: appendLog })).catch(() => {});
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : 'Sandbox failed',
      }));
    }
  }, [appendLog, initialFiles, writeFiles]);


  // Kill server on unmount
  useEffect(() => {
    return () => {
      if (serverRef.current) {
        try { serverRef.current.kill(); } catch {}
        serverRef.current = null;
      }
      previousBootServer = null;
    };
  }, []);

  useEffect(() => {
    if (enabled) void boot();
  }, [boot, enabled]);

  return { ...state, writeFiles, replaceFiles, triggerRefresh: doRefresh };
}
