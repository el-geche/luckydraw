import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OUTBOX, sha256, startApp } from './helpers.js';
import { verifyAudit, verifyBundle } from '@luckydraw/shared';

const { tick, AUTO_DRAW_SETTLE_MS } = await import('../src/services/draws.js');
let A;
before(async () => { A = await startApp(); });
after(async () => A.close());

test('seeded completed draws verify with the shared engine (v3 derivation)', async () => {
  const draws = (await A.call('GET', '/api/draws?status=drawn')).body;
  assert.ok(draws.length >= 4);
  for (const d of draws) {
    const audit = (await A.call('GET', `/api/draws/${d.id}/audit`)).body;
    const v = await verifyAudit(audit, { sha256 });
    assert.equal(v.ok, true, JSON.stringify(v.checks));
    assert.equal(audit.seedDerivation, 'luckydraw-seed-v3');
  }
});

test('one-click bundle verification passes for a seeded draw', async () => {
  const d = (await A.call('GET', '/api/draws?status=drawn')).body[0];
  const bundle = (await A.call('GET', `/api/draws/${d.id}/verification-bundle`)).body;
  const r = await verifyBundle(bundle);
  assert.notEqual(r.verdict, 'fail', JSON.stringify(r.steps.filter((s) => s.status === 'fail')));
  // Tampering with a public chain record is detected.
  bundle.chain.records[0].entryCount += 1;
  assert.equal((await verifyBundle(bundle)).verdict, 'fail');
});

test('backend enforces the 5-entries-per-person cap (also under concurrency)', async () => {
  const token = await A.login('hugo@luckydraw.demo');
  const admin = await A.login('admin@luckydraw.demo', 'admin123');
  const d = (await A.call('POST', '/api/admin/draws', { token: admin, body: { title: 'Cap test', mode: 'equal', prizeCents: 100, entryPriceCents: 10, durationMinutes: 30 } })).body;
  assert.equal((await A.call('POST', `/api/draws/${d.id}/entries`, { token, body: { count: 3 } })).status, 201);
  const over = await A.call('POST', `/api/draws/${d.id}/entries`, { token, body: { count: 3 } });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'ENTRY_CAP_EXCEEDED');
  const results = await Promise.all(Array.from({ length: 6 }, () => A.call('POST', `/api/draws/${d.id}/entries`, { token, body: { count: 1 } })));
  assert.equal(results.filter((r) => r.status === 201).length, 2);
  assert.equal((await A.call('GET', `/api/draws/${d.id}`, { token })).body.myEntries.length, 5);
});

test('admin runs a weighted draw: winner paid in demo wallet, audit verifies, winner notified with PDF', async () => {
  const admin = await A.login('admin@luckydraw.demo', 'admin123');
  const a = await A.login('ella@luckydraw.demo');
  const b = await A.login('finn@luckydraw.demo');
  const d = (await A.call('POST', '/api/admin/draws', { token: admin, body: { title: 'Weighted test', mode: 'weighted', prizeCents: 5000, entryPriceCents: 100, durationMinutes: 30 } })).body;
  await A.call('POST', `/api/draws/${d.id}/entries`, { token: a, body: { count: 2, tickets: 5 } });
  await A.call('POST', `/api/draws/${d.id}/entries`, { token: b, body: { count: 1, tickets: 1 } });
  assert.equal((await A.call('GET', `/api/draws/${d.id}`)).body.totalWeight, 11);
  const audit = (await A.call('POST', `/api/admin/draws/${d.id}/run`, { token: admin })).body;
  assert.equal(sha256(audit.serverSeed), d.seedCommitment);
  assert.equal((await verifyAudit(audit, { sha256 })).ok, true);
  const winnerToken = audit.winnerName.startsWith('Ella') ? a : b;
  const dash = (await A.call('GET', '/api/me/dashboard', { token: winnerToken })).body;
  assert.ok(dash.wallet.transactions.some((t) => t.type === 'prize_payout' && t.drawId === d.id && t.amountCents === 5000 && t.simulated));
  const box = (await A.call('GET', '/api/me/outbox', { token: winnerToken })).body;
  const win = box.find((m) => m.kind === 'winner_notification' && m.drawId === d.id);
  assert.ok(win, 'winner email in outbox');
  assert.equal(win.attachments[0].contentType, 'application/pdf');
  const eml = fs.readFileSync(path.join(OUTBOX, win.file), 'utf8');
  assert.match(eml, /Content-Type: application\/pdf/);
  assert.match(eml, /filename="?luckydraw-fairness-report-draw-\d+\.pdf/);
  assert.equal((await A.call('POST', `/api/admin/draws/${d.id}/run`, { token: admin })).status, 409);
});

test('non-admins cannot reach admin routes', async () => {
  const token = await A.login('ava@luckydraw.demo');
  for (const p of ['/api/admin/draws', '/api/admin/ledger', '/api/admin/reminders', '/api/admin/schedules', '/api/admin/compliance.pdf']) {
    assert.equal((await A.call('GET', p, { token })).status, 403, p);
    assert.equal((await A.call('GET', p)).status, 401, p);
  }
});

test('scheduler closes expired draws and auto-draws after settling', async () => {
  const admin = await A.login('admin@luckydraw.demo', 'admin123');
  const t = await A.login('grace@luckydraw.demo');
  const d = (await A.call('POST', '/api/admin/draws', { token: admin, body: { title: 'Auto test', mode: 'equal', prizeCents: 100, entryPriceCents: 0, durationMinutes: 1, autoDraw: true } })).body;
  await A.call('POST', `/api/draws/${d.id}/entries`, { token: t, body: { count: 2 } });
  const later = new Date(Date.now() + 2 * 60000);
  await tick(A.db, later);
  const closed = (await A.call('GET', `/api/draws/${d.id}`)).body;
  assert.equal(closed.status, 'closed');
  assert.match(closed.seal.hash, /^[0-9a-f]{64}$/);
  await tick(A.db, new Date(later.getTime() + AUTO_DRAW_SETTLE_MS + 1000));
  const done = (await A.call('GET', `/api/draws/${d.id}`)).body;
  assert.equal(done.status, 'drawn');
  assert.equal(done.winner.name, 'Grace A.');
});

test('demo deposit + referral registration', async () => {
  const reg = await A.call('POST', '/api/auth/register', { body: { email: 'new@luckydraw.demo', name: 'New Person', password: 'secret1', referralCode: 'AVA-7K2Q' } });
  assert.equal(reg.status, 201);
  const dep = await A.call('POST', '/api/me/wallet/deposit', { token: reg.body.token, body: { amountCents: 2500 } });
  assert.equal(dep.status, 201);
  assert.equal(dep.body.balanceCents, 5000 + 1000 + 2500);
  assert.equal((await A.call('POST', '/api/me/wallet/deposit', { token: reg.body.token, body: { amountCents: 99999999 } })).status, 400);
});

test('entering writes a proof-of-entry email + append-only audit-trail record; public receipt lookup is masked', async () => {
  const token = await A.login('hugo@luckydraw.demo');
  const open = (await A.call('GET', '/api/draws?status=open')).body.find((d) => d.mode === 'weighted');
  const r = await A.call('POST', `/api/draws/${open.id}/entries`, { token, body: { count: 2, tickets: 3 } });
  assert.equal(r.status, 201);
  assert.match(r.body.receipt.code, /^LD-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.match(r.body.auditRecord.recordHash, /^[0-9a-f]{64}$/);
  const mail = (await A.call('GET', '/api/me/outbox', { token })).body.find((m) => m.receiptCode === r.body.receipt.code);
  const full = (await A.call('GET', `/api/me/outbox/${mail.id}`, { token })).body;
  for (const id of r.body.receipt.entryIds) assert.ok(full.text.includes(`#${id}`));
  assert.ok(full.text.includes(`/verify-receipt?code=${r.body.receipt.code}`));
  const other = await A.login('ava@luckydraw.demo');
  assert.equal((await A.call('GET', `/api/me/outbox/${mail.id}`, { token: other })).status, 404);
  const rc = await A.call('GET', `/api/receipts/${r.body.receipt.code.toLowerCase()}`);
  assert.equal(rc.body.hashValid, true);
  assert.equal(rc.body.holder, 'H*** M.');
  assert.ok(!rc.text.includes('hugo@') && !rc.text.includes('Moreau'));
  assert.equal(rc.body.chain.recordHashValid, true);
  const mine = (await A.call('GET', '/api/me/receipts', { token })).body;
  assert.ok(mine.some((x) => x.receiptCode === r.body.receipt.code));
  // DB refuses edits to the trail.
  await assert.rejects(A.db.query('UPDATE confirmation_ledger SET entry_count = 9 WHERE receipt_code = $1', [r.body.receipt.code]));
  assert.equal((await A.call('GET', '/api/receipts/LD-0000-0000-0000-0000')).status, 404);
});

test('receipt lookup is rate limited', async () => {
  let limited = false;
  for (let i = 0; i < 80 && !limited; i++) limited = (await A.call('GET', '/api/receipts/LD-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).status === 429;
  assert.ok(limited);
});

test('audit exports (JSON + CSV) carry a reproducible sha256 and bundle trail + anchors', async () => {
  const drawn = (await A.call('GET', '/api/draws?status=drawn')).body.at(-1);
  const jr = await A.raw(`/api/draws/${drawn.id}/export.json`);
  const json = await jr.json();
  assert.equal(sha256(JSON.stringify(json.content)), json.exportSha256);
  assert.equal(jr.headers.get('x-export-sha256'), json.exportSha256);
  assert.equal(json.content.winner.entryId, drawn.winner.entryId);
  assert.equal(json.content.confirmationTrail.records.length, json.content.seal.count);
  assert.ok(Array.isArray(json.content.anchors));
  assert.ok(!JSON.stringify(json.content).includes('@luckydraw.demo'));
  const csv = await (await A.raw(`/api/draws/${drawn.id}/export.csv`)).text();
  const idx = csv.lastIndexOf('# export_sha256,');
  assert.equal(sha256(csv.slice(0, idx)), csv.slice(idx + 16).trim());
  assert.ok(csv.includes(`# server_seed,${json.content.serverSeed}`) && csv.includes('# confirmation_trail'));
  const open = (await A.call('GET', '/api/draws?status=open')).body[0];
  assert.equal((await A.raw(`/api/draws/${open.id}/export.json`)).status, 404);
});

test('admin trail export (filtered) includes chain hashes and verifies', async () => {
  const admin = await A.login('admin@luckydraw.demo', 'admin123');
  const v = (await A.call('GET', '/api/admin/ledger/verify', { token: admin })).body;
  assert.equal(v.ok, true);
  const j = (await A.call('GET', '/api/admin/ledger/export.json?drawId=1', { token: admin })).body;
  assert.ok(j.content.rows.length > 0 && j.content.rows.every((r) => r.drawId === 1 && /^[0-9a-f]{64}$/.test(r.recordHash)));
  const csv = (await A.call('GET', '/api/admin/ledger/export.csv', { token: admin })).text;
  assert.match(csv.split('\n').find((l) => !l.startsWith('#')), /record_hash|recordHash/);
});
