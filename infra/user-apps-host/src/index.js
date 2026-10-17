/**
 * Serves deployed user apps: `<slug>.edelsteinquest.store/<path>` → R2 `live/<slug>/<path>`.
 *
 * Cost guard: every request makes at most ONE R2 read, and cache hits make
 * none. The Worker runs on the free plan, whose 100k requests/day hard cap
 * therefore also caps R2 reads (~3M/month) below R2's 10M/month free tier.
 * Do not add a second R2 call per request, and do not move this Worker to
 * the paid plan without adding another limit.
 *
 * - Paths with a file extension are served as-is (404 if missing).
 * - Paths without one get the app's index.html (SPA client-side routing).
 * - Taking an app down = deleting its `live/<slug>/` prefix from R2. HTML and
 *   404s are never cached, so takedowns and redeploys apply immediately; only
 *   content-hashed assets are, as they never change under the same name.
 */

const ROOT_DOMAIN = 'edelsteinquest.store';
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

const HTML_CACHE = 'no-cache';
const ASSET_CACHE = 'public, max-age=31536000, immutable';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
    const slug = resolveSlug(url.hostname);
    if (!slug) return notFound();

    const key = resolveKey(slug, url.pathname);
    if (!key) return notFound();

    const isHtml = key.endsWith('.html');
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    if (!isHtml) {
      const cached = await cache.match(cacheKey);
      if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached;
    }

    const object = await env.APPS.get(key);
    if (!object) return notFound();
    const response = fileResponse(object, isHtml);
    if (!isHtml) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return request.method === 'HEAD' ? new Response(null, response) : response;
  },
};

function resolveSlug(hostname) {
  const suffix = `.${ROOT_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  return SLUG.test(slug) && !RESERVED.has(slug) ? slug : null;
}

function resolveKey(slug, pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..' || s.includes('\\'))) return null;
  const last = segments.at(-1) ?? '';
  const file = last.includes('.') ? segments.join('/') : 'index.html';
  return `live/${slug}/${file}`;
}

function fileResponse(object, isHtml) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', isHtml ? HTML_CACHE : ASSET_CACHE);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

function notFound() {
  return new Response('App not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
