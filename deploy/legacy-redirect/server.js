/**
 * Legacy-host redirect for LuckyDraw (zero dependencies).
 * Holds the old Railway domain and permanently redirects every request to NEW_ORIGIN, keeping path + query.
 * Exception: /sw.js (and the registerSW helper) return a self-destroying service worker, so browsers that
 * installed the PWA on the old origin drop their cached shell and follow the redirect on the next navigation
 * (a SW script fetch must not be redirected, or the old worker would keep serving cached pages).
 */
import http from 'node:http';

export const NEW_ORIGIN = (process.env.NEW_ORIGIN || 'https://luckydraw.up.railway.app').replace(/\/+$/, '');

export const KILL_SWITCH_SW = `// LuckyDraw moved to ${NEW_ORIGIN}. This worker removes the old offline cache and itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { const u = new URL(c.url); c.navigate(${JSON.stringify(NEW_ORIGIN)} + u.pathname + u.search + u.hash); } catch (e) { /* ignore */ }
    }
  })());
});
self.addEventListener('fetch', () => { /* no respondWith: always go to the network (which 301s) */ });
`;

export function handle(req, res) {
  const url = req.url || '/';
  const path = url.split('?')[0];
  if (path === '/sw.js' || path === '/service-worker.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Clear-Site-Data': '"cache", "storage"' });
    return res.end(KILL_SWITCH_SW);
  }
  if (path === '/_redirect/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, redirectsTo: NEW_ORIGIN }));
  }
  const location = NEW_ORIGIN + (url.startsWith('/') ? url : `/${url}`);
  res.writeHead(301, { Location: location, 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end(`Moved permanently to ${location}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT || 8080);
  http.createServer(handle).listen(port, () => console.log(`[legacy-redirect] :${port} -> ${NEW_ORIGIN}`));
}
