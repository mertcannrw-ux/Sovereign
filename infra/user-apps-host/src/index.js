/**
 * Serves deployed user apps: `<slug>.<ROOT_DOMAIN>/<path>` → R2 `live/<slug>/<path>`.
 *
 * Cost guard: every request makes at most ONE R2 read, and cache hits make
 * none. The Worker runs on the free plan, whose 100k requests/day hard cap
 * therefore also caps R2 reads (~3M/month) below R2's 10M/month free tier.
 * Do not add a second R2 call per request, and do not move this Worker to
 * the paid plan without adding another limit.
 *
 * - Paths with a file extension are served as-is (404 if missing).
 * - Paths without one get the app's index.html (SPA client-side routing).
 * - Taking an app down = deleting its `live/<slug>/` prefix from R2. Only
 *   content-hashed build assets (`assets/name-<hash>.ext`) are cached, since
 *   they never change under the same name, and the edge keeps them for at
 *   most EDGE_ASSET_TTL. Everything else (HTML, `public/` files like
 *   favicon.ico, 404s) is never cached, so takedowns and redeploys apply
 *   immediately to those and within EDGE_ASSET_TTL to hashed assets.
 */

const RESERVED = new Set([
  'www',
  'api',
  'app',
  'mail',
  'admin',
  'proxy',
  'relay',
  'test',
  'status',
]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Vite's default output name: `assets/<name>-<8+ char base64url hash>.<ext>`. */
const HASHED_ASSET = /^assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

const EDGE_ASSET_TTL = 60 * 60;
const UNCACHED = 'no-cache';
// Browsers may keep hashed assets forever; s-maxage bounds how long the edge
// cache keeps serving one after its app is taken down.
const HASHED_ASSET_CACHE = `public, max-age=31536000, s-maxage=${EDGE_ASSET_TTL}, immutable`;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
    const slug = resolveSlug(url.hostname, env.ROOT_DOMAIN);
    if (!slug) return notFound();

    const file = resolveFile(url.pathname);
    if (!file) return notFound();
    const key = `live/${slug}/${file}`;

    const cacheable = HASHED_ASSET.test(file);
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    if (cacheable) {
      const cached = await cache.match(cacheKey);
      if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached;
    }

    const object = await env.APPS.get(key);
    if (!object) return notFound();
    const response = fileResponse(object, cacheable);
    if (cacheable) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return request.method === 'HEAD' ? new Response(null, response) : response;
  },
};

function resolveSlug(hostname, rootDomain) {
  if (!rootDomain) return null;
  const suffix = `.${rootDomain}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  return SLUG.test(slug) && !RESERVED.has(slug) ? slug : null;
}

/** The bundle-relative file for a request path, or null if the path is unsafe. */
function resolveFile(pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..' || s.includes('\\'))) return null;
  const last = segments.at(-1) ?? '';
  return last.includes('.') ? segments.join('/') : 'index.html';
}

function fileResponse(object, cacheable) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', cacheable ? HASHED_ASSET_CACHE : UNCACHED);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

function notFound() {
  return new Response('App not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
