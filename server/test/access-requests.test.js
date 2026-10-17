import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('access requests: validated, honeypot, stored, outbox notification, admin-only list, never creates an account; register stays 403', async () => {
  const prev = process.env.REGISTRATION_MODE;
  process.env.REGISTRATION_MODE = 'closed';
  const app = await startApp();
  try {
    const users0 = (await app.db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;

    assert.equal((await app.call('POST', '/api/access-requests', { body: { name: 'A', email: 'x@example.test' } })).status, 400);
    assert.equal((await app.call('POST', '/api/access-requests', { body: { name: 'Valid Name', email: 'not-an-email' } })).status, 400);
    assert.equal((await app.call('POST', '/api/access-requests', { body: { name: 'Valid Name', email: 'v@example.test', message: 'x'.repeat(501) } })).status, 400);

    const bot = await app.call('POST', '/api/access-requests', { body: { name: 'Spam Bot', email: 'bot@example.test', website: 'http://spam' } });
    assert.equal(bot.status, 202);
    assert.equal((await app.db.query("SELECT 1 FROM access_requests WHERE email = 'bot@example.test'")).rows.length, 0, 'honeypot hits are not stored');

    const ok = await app.call('POST', '/api/access-requests', { body: { name: '  Grace   Hopper ', email: 'Grace@Example.TEST', message: 'Please <b>invite</b> me' } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.accountCreated, false);
    assert.match(ok.body.message, /does not create an account/);
    const { rows: [r] } = await app.db.query('SELECT * FROM access_requests WHERE id = $1', [ok.body.id]);
    assert.equal(r.name, 'Grace Hopper');
    assert.equal(r.email, 'grace@example.test');
    const { rows: [mail] } = await app.db.query('SELECT * FROM outbox_emails WHERE id = $1', [r.email_id]);
    assert.equal(mail.kind, 'access_request');
    assert.ok(!mail.html.includes('<b>invite</b>'), 'message is HTML-escaped in the notification');

    assert.equal((await app.db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n, users0, 'no account created');
    assert.equal((await app.call('POST', '/api/auth/login', { body: { email: 'grace@example.test', password: 'whatever1' } })).status, 401);

    // Admin-only listing
    assert.equal((await app.call('GET', '/api/admin/access-requests')).status, 401);
    const member = await app.login('ava@luckydraw.demo');
    assert.equal((await app.call('GET', '/api/admin/access-requests', { token: member })).status, 403);
    const admin = await app.login('admin@luckydraw.demo', 'admin123');
    const list = await app.call('GET', '/api/admin/access-requests', { token: admin });
    assert.equal(list.status, 200);
    assert.ok(list.body.some((x) => x.id === ok.body.id && x.email === 'grace@example.test'));

    // Registration stays closed
    const reg = await app.call('POST', '/api/auth/register', { body: { email: 'new@example.test', name: 'New Person', password: 'secret123' } });
    assert.equal(reg.status, 403);
    assert.equal(reg.body.error, 'Registration is closed');
  } finally {
    if (prev === undefined) delete process.env.REGISTRATION_MODE; else process.env.REGISTRATION_MODE = prev;
    await app.close();
  }
});

test('access requests: light per-IP rate limit', async () => {
  const app = await startApp();
  try {
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const r = await app.raw('/api/access-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' }, body: JSON.stringify({ name: `Rate ${i}`, email: `rate${i}@example.test` }) });
      statuses.push(r.status);
    }
    assert.deepEqual(statuses.slice(0, 5), [201, 201, 201, 201, 201]);
    assert.equal(statuses[6], 429);
  } finally { await app.close(); }
});
