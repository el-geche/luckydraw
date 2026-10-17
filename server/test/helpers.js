// Shared harness: isolated outbox, in-memory PGlite, no network (entropy + anchors disabled unless a test opts in).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const OUTBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-outbox-'));
process.env.OUTBOX_DIR = OUTBOX;
process.env.MAIL_TRANSPORT = 'outbox';
process.env.ENTROPY_PROVIDER ??= 'none';
process.env.ANCHOR_PROVIDERS ??= 'none';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function startApp() {
  const { createDb } = await import('../src/db/index.js');
  const { createApp } = await import('../src/app.js');
  const { seedDatabase } = await import('../src/seed.js');
  const db = await createDb({ databaseUrl: process.env.TEST_DATABASE_URL || '', dataDir: 'memory://' });
  await seedDatabase(db);
  const server = createApp(db).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const raw = (p, opts = {}) => fetch(base + p, opts);
  const call = async (method, p, { token, body } = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers, text };
  };
  const login = async (email, password = 'demo123') => (await call('POST', '/api/auth/login', { body: { email, password } })).body.token;
  return { db, server, base, call, raw, login, close: async () => { server.close(); await db.close(); } };
}
