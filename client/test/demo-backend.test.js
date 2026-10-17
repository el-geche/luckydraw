/**
 * The static (GitHub Pages / Vercel) build runs the real server app in the browser through the
 * Express shim in src/demo/shims/express.js. This test drives that exact shim + the real server app
 * (PGlite in memory) the way the browser does: quick demo login, form login, wrong password, admin access,
 * sign-up and entering a draw.
 */
import { register } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

register('./demo-hooks.mjs', import.meta.url);
process.env.MAIL_TRANSPORT = 'none';
process.env.ANCHOR_PROVIDERS = 'none';
process.env.ENTROPY_PROVIDER = 'none';

let db; let app; let dispatch;
const call = async (method, url, { body, token } = {}) => {
  const r = await dispatch(app, { method, url, body, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, json: r.body ? JSON.parse(typeof r.body === 'string' ? r.body : new TextDecoder().decode(r.body)) : null };
};

before(async () => {
  ({ dispatch } = await import('../src/demo/shims/express.js'));
  const { createDb } = await import('../../server/src/db/index.js');
  const { seedDatabase } = await import('../../server/src/seed.js');
  const { createApp } = await import('../../server/src/app.js');
  db = await createDb({ databaseUrl: '', dataDir: 'memory://' });
  await seedDatabase(db);
  app = createApp(db);
});
after(async () => { await db?.close(); });

test('browser demo backend: quick demo login for every seeded account', async () => {
  const { status, json: accounts } = await call('GET', '/api/auth/demo-accounts');
  assert.equal(status, 200);
  assert.ok(accounts.length >= 9);
  for (const a of accounts) {
    const r = await call('POST', '/api/auth/login', { body: { email: a.email, password: a.password } });
    assert.equal(r.status, 200, a.email);
    assert.equal(r.json.user.email, a.email);
    const me = await call('GET', '/api/auth/me', { token: r.json.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.role, a.role);
  }
});

test('browser demo backend: form login, wrong password, admin access, sign-up and entry', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { email: 'admin@luckydraw.demo', password: 'nope' } });
  assert.equal(bad.status, 401);
  assert.match(bad.json.error, /Invalid email or password/);

  const admin = await call('POST', '/api/auth/login', { body: { email: 'admin@luckydraw.demo', password: 'admin123' } });
  assert.equal(admin.status, 200);
  assert.equal((await call('GET', '/api/admin/users', { token: admin.json.token })).status, 200);
  const ava = await call('POST', '/api/auth/login', { body: { email: 'ava@luckydraw.demo', password: 'demo123' } });
  assert.equal((await call('GET', '/api/admin/users', { token: ava.json.token })).status, 403);
  assert.equal((await call('GET', '/api/admin/users')).status, 401);

  const reg = await call('POST', '/api/auth/register', { body: { email: `new${Date.now()}@example.test`, name: 'New Member', password: 'secret12' } });
  assert.ok([200, 201].includes(reg.status), JSON.stringify(reg.json));
  const draws = (await call('GET', '/api/draws?status=open')).json;
  const open = (Array.isArray(draws) ? draws : draws.draws).find((d) => d.status === 'open');
  assert.ok(open, 'an open draw exists');
  const entry = await call('POST', `/api/draws/${open.id}/entries`, { token: reg.json.token, body: { count: 1, tickets: 1 } });
  assert.ok([200, 201].includes(entry.status), JSON.stringify(entry.json));
  // params with dots ("export.:fmt") and router prefixes resolve like Express
  assert.equal((await call('GET', '/api/nope')).status, 404);
});
