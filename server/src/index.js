import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { createDb, migrate } from './db/index.js';
import { createApp } from './app.js';
import { schedulerPass } from './services/lifecycle.js';
import { seedDatabase, isDatabaseEmpty } from './seed.js';

const db = await createDb();
await migrate(db);
const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
// Auto-seed only a brand-new database. Where reset is disabled (hosted/production) every core table must be empty,
// so a deployment with existing draws/entries can never be wiped by a startup reseed.
if (n === 0 && (config.allowDemoReset || (await isDatabaseEmpty(db)))) {
  console.log('[luckydraw] empty database — loading demo seed data…');
  await seedDatabase(db, { log: console.log });
}

const app = createApp(db);

// Production convenience: serve the built client (npm run build) from the API server.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(path.join(dist, 'index.html')) && process.env.SERVE_CLIENT !== 'false') {
  // Service worker + manifest must always revalidate so updates are picked up; hashed assets are immutable.
  app.use(express.static(dist, {
    setHeaders(res, file) {
      const base = path.basename(file);
      if (base === 'sw.js' || base.startsWith('workbox-') || base === 'manifest.webmanifest' || base === 'index.html') res.setHeader('Cache-Control', 'no-cache');
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (base === 'manifest.webmanifest') res.setHeader('Content-Type', 'application/manifest+json');
    },
  }));
  // SPA fallback: deep links / home-screen launches of any client route get index.html.
  app.get(/^(?!\/api|\/share).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
}
console.log(`[luckydraw] demo reset ${config.allowDemoReset ? 'ENABLED' : 'disabled'} on this deployment`);
const server = app.listen(config.port, () => {
  console.log(`[luckydraw] API listening on http://localhost:${config.port}  (db: ${db.describe})`);
  console.log('[luckydraw] DEMO MODE — all money is simulated.');
});

let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { await schedulerPass(db); } catch (e) { console.error('[scheduler]', e.message); } finally { ticking = false; }
}, config.schedulerIntervalMs);

const shutdown = async () => {
  clearInterval(timer);
  server.close();
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
