import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('REGISTRATION_MODE: open by default, closed -> 403 and exposed in /api/meta', async () => {
  const prev = process.env.REGISTRATION_MODE;
  const app = await startApp();
  try {
    delete process.env.REGISTRATION_MODE;
    let meta = await app.call('GET', '/api/meta');
    assert.equal(meta.body.registrationMode, 'open');
    const ok = await app.call('POST', '/api/auth/register', { body: { email: 'open-mode@example.test', name: 'Open Mode', password: 'secret123' } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));

    process.env.REGISTRATION_MODE = 'closed';
    meta = await app.call('GET', '/api/meta');
    assert.equal(meta.body.registrationMode, 'closed');
    const denied = await app.call('POST', '/api/auth/register', { body: { email: 'closed-mode@example.test', name: 'Closed Mode', password: 'secret123' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'Registration is closed');
    const { rows } = await app.db.query("SELECT 1 FROM users WHERE email = 'closed-mode@example.test'");
    assert.equal(rows.length, 0, 'no account created while closed');
    // Existing accounts can still sign in while sign-up is closed.
    assert.ok(await app.login('ava@luckydraw.demo'));

    process.env.REGISTRATION_MODE = 'anything-else';
    assert.equal((await app.call('GET', '/api/meta')).body.registrationMode, 'open');
  } finally {
    if (prev === undefined) delete process.env.REGISTRATION_MODE; else process.env.REGISTRATION_MODE = prev;
    await app.close();
  }
});
