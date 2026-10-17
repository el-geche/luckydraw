/**
 * In-browser demo backend for static hosting (GitHub Pages / Vercel static).
 *
 * Runs the REAL server code (server/src/app.js, routes, services, seed) in the page, against
 * PGlite (Postgres compiled to WASM) persisted in IndexedDB. Node-only modules are swapped for small
 * browser shims at build time (see vite.config.js). Nothing leaves the browser except read-only
 * drand beacon GETs; no email is sent and no anchors are submitted.
 */
import './prelude.js';
import { dispatch } from './shims/express.js';

const DATA_VERSION = '1';
const VERSION_KEY = 'luckydraw.demo.dataVersion';
let booting = null;
let status = { state: 'idle' };
const listeners = new Set();
const setStatus = (s) => { status = s; listeners.forEach((fn) => fn(s)); };
export const getDemoStatus = () => status;
export const onDemoStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

async function boot() {
  setStatus({ state: 'starting', message: 'Starting the in-browser demo backend…' });
  const [{ createApp }, { createDb, migrate }, { seedDatabase }, { schedulerPass }] = await Promise.all([
    import('../../../server/src/app.js'),
    import('../../../server/src/db/index.js'),
    import('../../../server/src/seed.js'),
    import('../../../server/src/services/lifecycle.js'),
  ]);
  void createDb; // same adapter shape as server/src/db/index.js, with relaxed IndexedDB durability (much faster)
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(globalThis.__LD_ENV__.PGLITE_DIR, { relaxedDurability: true });
  await pg.waitReady;
  const db = {
    kind: 'pglite', describe: 'PGlite (in-browser, IndexedDB)',
    query: (text, params) => pg.query(text, params),
    exec: (sql) => pg.exec(sql),
    tx: (fn) => pg.transaction((t) => fn({ query: (text, params) => t.query(text, params) })),
    close: () => pg.close(),
  };
  let seeded = false;
  try { seeded = localStorage.getItem(VERSION_KEY) === DATA_VERSION && (await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n > 0; } catch { seeded = false; }
  const seed = async () => {
    setStatus({ state: 'seeding', message: 'Preparing demo data in your browser (first visit only)…' });
    const t = performance.now();
    await seedDatabase(db, { log: (m) => console.info('[demo seed]', m) });
    console.info(`[demo seed] done in ${Math.round(performance.now() - t)} ms`);
    localStorage.setItem(VERSION_KEY, DATA_VERSION);
  };
  if (!seeded) await seed(); else await migrate(db);
  const app = createApp(db);
  let running = false;
  const pass = async () => {
    if (running) return; running = true;
    try { await schedulerPass(db, { anchors: false }); } catch (e) { console.warn('[demo scheduler]', e?.message); } finally { running = false; }
  };
  setInterval(pass, 3000);
  pass();
  setStatus({ state: 'ready' });
  return { db, app, seed, pass };
}

export function startDemoBackend() {
  booting ??= boot().catch((e) => { booting = null; console.error('[demo backend]', e); setStatus({ state: 'error', message: e?.message || String(e) }); throw e; });
  return booting;
}

/** fetch()-compatible entry point: demoFetch('/api/...', init) -> Response. */
export async function demoFetch(url, init = {}) {
  const { app } = await startDemoBackend();
  const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : { ...(init.headers || {}) };
  let body = init.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = Object.fromEntries(new URLSearchParams(body)); } }
  const r = await dispatch(app, { method: init.method || 'GET', url, headers, body });
  const status = r.status === 304 ? 200 : r.status;
  return new Response([101, 204, 205, 304].includes(r.status) ? null : r.body, { status, headers: r.headers });
}

/** Wipe this device's demo data and reseed (also signs the visitor out). */
export async function resetDemoData() {
  const b = await startDemoBackend();
  await b.seed();
  await b.pass();
}
