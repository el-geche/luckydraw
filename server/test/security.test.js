import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startApp } from './helpers.js';

const withEnv = async (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};
const counts = async (db) => (await db.query('SELECT (SELECT COUNT(*) FROM users)::int AS users, (SELECT COUNT(*) FROM draws)::int AS draws, (SELECT COUNT(*) FROM entries)::int AS entries')).rows[0];

test('demo reset: disabled by default for NODE_ENV=production / DATABASE_URL, 403 and data untouched; seedDatabase refuses too', async () => {
  const app = await startApp();
  try {
    const admin = await app.login('admin@luckydraw.demo', 'admin123');
    // Simulate an extra real user so a wipe would be visible.
    await app.db.query("INSERT INTO users (email, name, password_hash, role, referral_code) VALUES ('keep@example.test','Keep Me','x','member','KEEP-0001')");
    const before = await counts(app.db);

    await withEnv({ ALLOW_DEMO_RESET: undefined, NODE_ENV: 'production' }, async () => {
      assert.equal((await app.call('GET', '/api/meta')).body.demoResetEnabled, false);
      const r = await app.call('POST', '/api/admin/reset', { token: admin });
      assert.equal(r.status, 403);
      assert.equal(r.body.error, 'Reset is disabled on this deployment');
      const { seedDatabase } = await import('../src/seed.js');
      await assert.rejects(() => seedDatabase(app.db), /Refusing to reseed/);
    });
    await withEnv({ ALLOW_DEMO_RESET: undefined, NODE_ENV: undefined, DATABASE_URL: 'postgres://example.invalid/db' }, async () => {
      const { config } = await import('../src/config.js');
      assert.equal(config.allowDemoReset, false, 'hosted database => reset off by default');
    });
    await withEnv({ ALLOW_DEMO_RESET: 'false', NODE_ENV: undefined }, async () => {
      assert.equal((await app.call('POST', '/api/admin/reset', { token: admin })).status, 403);
    });
    assert.deepEqual(await counts(app.db), before, 'no data was wiped');

    // Local demo (no DATABASE_URL, not production) keeps the reset.
    await withEnv({ ALLOW_DEMO_RESET: undefined, NODE_ENV: undefined }, async () => {
      assert.equal((await app.call('GET', '/api/meta')).body.demoResetEnabled, true);
    });
    // Members can never reset.
    const member = await app.login('ava@luckydraw.demo');
    assert.equal((await app.call('POST', '/api/admin/reset', { token: member })).status, 403);
  } finally { await app.close(); }
});

test('auth: token of a deleted user gets 401; role comes from the database', async () => {
  const app = await startApp();
  try {
    const { config } = await import('../src/config.js');
    // A forged-but-validly-signed admin token for a user id that does not exist.
    const ghost = jwt.sign({ sub: 99999, role: 'admin', name: 'Ghost' }, config.jwtSecret, { expiresIn: '1h' });
    assert.equal((await app.call('GET', '/api/auth/me', { token: ghost })).status, 401);
    assert.equal((await app.call('GET', '/api/admin/users', { token: ghost })).status, 401);
    assert.equal((await app.call('GET', '/api/admin/access-requests', { token: ghost })).status, 401);
    // Public routes still work with a stale token (treated as anonymous).
    assert.equal((await app.call('GET', '/api/draws', { token: ghost })).status, 200);

    // Real user deleted after the token was issued.
    const { rows: [u] } = await app.db.query("INSERT INTO users (email, name, password_hash, role, referral_code) VALUES ('temp-admin@example.test','Temp Admin','x','admin','TEMP-0001') RETURNING *");
    const tok = jwt.sign({ sub: u.id, role: 'admin', name: u.name }, config.jwtSecret, { expiresIn: '1h' });
    assert.equal((await app.call('GET', '/api/admin/users', { token: tok })).status, 200);
    // Role downgrade in the DB is honoured immediately even though the token still says admin.
    await app.db.query("UPDATE users SET role = 'member' WHERE id = $1", [u.id]);
    assert.equal((await app.call('GET', '/api/admin/users', { token: tok })).status, 403);
    assert.equal((await app.call('GET', '/api/auth/me', { token: tok })).status, 200);
    // Upgrade is honoured too: a member token for a user promoted in the DB gets admin access.
    const { rows: [m] } = await app.db.query("SELECT id FROM users WHERE email = 'ava@luckydraw.demo'");
    const memberTok = await app.login('ava@luckydraw.demo');
    await app.db.query("UPDATE users SET role = 'admin' WHERE id = $1", [m.id]);
    assert.equal((await app.call('GET', '/api/admin/users', { token: memberTok })).status, 200);
    await app.db.query("UPDATE users SET role = 'member' WHERE id = $1", [m.id]);
    // Deletion => 401.
    await app.db.query('DELETE FROM users WHERE id = $1', [u.id]);
    assert.equal((await app.call('GET', '/api/admin/users', { token: tok })).status, 401);
    assert.equal((await app.call('GET', '/api/auth/me', { token: tok })).status, 401);
  } finally { await app.close(); }
});
