import './env-fairness.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OUTBOX, sha256, startApp } from './helpers.js';
import { verifyBundle } from '@luckydraw/shared';

const { setEntropyFetch, roundTime } = await import('../src/services/entropy.js');
const { registerAnchorProvider, processAnchors } = await import('../src/services/anchors.js');
const { executeDraw, tick } = await import('../src/services/draws.js');
const { schedulerPass } = await import('../src/services/lifecycle.js');
const { processReminders } = await import('../src/services/reminders.js');
const { materializeSchedules, occurrences } = await import('../src/services/schedules.js');
const { notifyWinner } = await import('../src/services/winner.js');

// Mock drand: deterministic value per round, but only once the round's time has passed in "mock time".
let mockNow = () => new Date(8e15);
setEntropyFetch(async (url) => {
  const round = Number(url.split('/').pop());
  if (roundTime(round) > mockNow()) return new Response('{}', { status: 404 });
  return Response.json({ round, randomness: sha256(`round-${round}`), signature: 'mock' });
});
// Mock anchor provider: fails on first attempt (to exercise retry), then "confirms".
const calls = new Map();
registerAnchorProvider({ name: 'mock', async submit(a) {
  const n = (calls.get(a.id) ?? 0) + 1; calls.set(a.id, n);
  if (n === 1) throw new Error('calendar unreachable (mock)');
  return { status: 'confirmed', proof: Buffer.concat([Buffer.from('mock-proof:'), Buffer.from(a.digest, 'hex')]), format: 'tsr', info: { mock: true } };
} });

let A, admin;
before(async () => { A = await startApp(); admin = await A.login('admin@luckydraw.demo', 'admin123'); });
after(async () => A.close());

const ENDPOINTS = (id) => [
  '/api/draws', '/api/draws?status=open', '/api/draws?status=closed', `/api/draws/${id}`, `/api/draws/${id}/audit`, `/api/draws/${id}/anchors`,
  `/api/draws/${id}/chain.json`, `/api/draws/${id}/verification-bundle`, `/api/draws/${id}/export.json`, `/api/draws/${id}/export.csv`, `/api/draws/${id}/announcement`,
  '/api/history', '/api/upcoming', '/api/admin/draws', `/api/admin/draws/${id}`, `/api/admin/logs?drawId=${id}`, '/api/admin/logs', '/api/admin/ledger',
  `/api/admin/ledger/export.json?drawId=${id}`, '/api/admin/anchors', '/api/admin/calendar', '/api/admin/announcement-events', '/api/admin/compliance.html',
];

test('server seed never leaves the server before the draw is closed AND sealed AND run', async () => {
  const { rows } = await A.db.query(`SELECT id, seed, status FROM draws WHERE status IN ('scheduled','open','closed')`);
  assert.ok(rows.some((r) => r.status === 'open') && rows.some((r) => r.status === 'closed') && rows.some((r) => r.status === 'scheduled'));
  for (const d of rows) {
    for (const p of ENDPOINTS(d.id)) for (const token of [undefined, admin]) {
      const r = await A.call('GET', p, { token });
      assert.ok(!r.text.includes(d.seed), `seed of draw #${d.id} (${d.status}) leaked via ${p} (${token ? 'admin' : 'public'})`);
    }
    const pdf = await (await A.raw(`/api/draws/${d.id}/report.pdf`)).arrayBuffer();
    assert.ok(!Buffer.from(pdf).toString('latin1').includes(d.seed), `seed leaked in PDF #${d.id}`);
  }
  for (const f of fs.readdirSync(OUTBOX)) {
    const body = fs.readFileSync(`${OUTBOX}/${f}`, 'utf8');
    for (const d of rows) assert.ok(!body.includes(d.seed), `seed leaked in outbox file ${f}`);
  }
  const { rows: logs } = await A.db.query('SELECT details::text AS t FROM draw_logs');
  for (const d of rows) assert.ok(logs.every((l) => !l.t.includes(d.seed)));
});

test('draw waits for the drand round committed at seal, then derives the v3 seed; bundle verifies', async () => {
  const t = await A.login('chloe@luckydraw.demo');
  const d = (await A.call('POST', '/api/admin/draws', { token: admin, body: { title: 'Beacon test', mode: 'equal', prizeCents: 100, entryPriceCents: 0, durationMinutes: 5 } })).body;
  await A.call('POST', `/api/draws/${d.id}/entries`, { token: t, body: { count: 2 } });
  await A.call('POST', `/api/draws/${d.id}/entries`, { token: await A.login('ben@luckydraw.demo'), body: { count: 1 } });
  mockNow = () => new Date();
  const r = await A.call('POST', `/api/admin/draws/${d.id}/run`, { token: admin });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.pending, true);
  const row = (await A.db.query('SELECT * FROM draws WHERE id = $1', [d.id])).rows[0];
  assert.equal(row.status, 'closed');
  assert.ok(row.seal_hash && row.entropy_round && row.run_requested);
  assert.ok(roundTime(row.entropy_round) > new Date(row.sealed_at), 'round is strictly after seal');
  assert.equal((await A.call('GET', `/api/draws/${d.id}/audit`)).status, 404);
  // Time passes: scheduler runs it once the beacon exists.
  const later = new Date(roundTime(row.entropy_round).getTime() + 5000);
  mockNow = () => later;
  await tick(A.db, later);
  const audit = (await A.call('GET', `/api/draws/${d.id}/audit`)).body;
  assert.equal(audit.publicEntropy.source, 'drand');
  assert.equal(audit.publicEntropy.value, sha256(`round-${row.entropy_round}`));
  assert.equal(audit.receiptCodes.length, 2);
  const bundle = (await A.call('GET', `/api/draws/${d.id}/verification-bundle`)).body;
  const v = await verifyBundle(bundle);
  assert.notEqual(v.verdict, 'fail', JSON.stringify(v.firstFail));
  // Changing the beacon value breaks the derivation.
  bundle.audit.publicEntropy.value = sha256('other');
  assert.equal((await verifyBundle(bundle)).firstFail.key, 'public');
});

test('sealed chains reject appends', async () => {
  const closed = (await A.db.query(`SELECT id FROM draws WHERE status='closed' AND sealed_at IS NOT NULL LIMIT 1`)).rows[0];
  const r = await A.call('POST', `/api/draws/${closed.id}/entries`, { token: await A.login('ava@luckydraw.demo'), body: { count: 1 } });
  assert.equal(r.status, 409);
  const { appendConfirmation } = await import('../src/services/ledger.js');
  await assert.rejects(A.db.tx((q) => appendConfirmation(q, { drawId: closed.id, userId: 2, receipt: { code: 'X' } })));
});

test('anchors: failure stays pending and is retried; confirmed proof commits to the sealed hash', async () => {
  const far = new Date(Date.now() + 86400_000);
  await processAnchors(A.db, far); // first attempt fails for each
  let rows = (await A.db.query('SELECT * FROM draw_anchors ORDER BY id LIMIT 10')).rows;
  assert.ok(rows.every((a) => a.status === 'pending' && a.attempts === 1 && /unreachable/.test(a.last_error)));
  for (let i = 0; i < 6; i++) await processAnchors(A.db, new Date(far.getTime() + 3600_000 * (i + 1)));
  const drawn = (await A.call('GET', '/api/draws?status=drawn')).body[0];
  const anchors = (await A.call('GET', `/api/draws/${drawn.id}/anchors`)).body;
  const seal = anchors.find((a) => a.kind === 'seal');
  assert.equal(seal.status, 'confirmed');
  assert.ok(seal.digestInput.includes(drawn.seal.hash));
  const proof = Buffer.from(await (await A.raw(`/api/draws/${drawn.id}/anchors/${seal.id}/proof.tsr`)).arrayBuffer());
  assert.ok(proof.includes(Buffer.from(seal.digest, 'hex')));
  const v = await verifyBundle((await A.call('GET', `/api/draws/${drawn.id}/verification-bundle`)).body);
  assert.equal(v.steps.find((s) => s.key === 'anchor:mock').status, 'pass');
  const ex = (await A.call('GET', `/api/draws/${drawn.id}/export.json`)).body;
  assert.ok(ex.content.anchors.some((a) => a.proofB64));
});

test('winner notification: never before seal/run; carries the fairness PDF; logged', async () => {
  const open = (await A.db.query(`SELECT id FROM draws WHERE status='open' LIMIT 1`)).rows[0];
  await assert.rejects(notifyWinner(A.db, open.id), /only generated after/);
  const drawn = (await A.call('GET', '/api/draws?status=drawn')).body[0];
  const r = await A.call('POST', `/api/admin/draws/${drawn.id}/notify-winner`, { token: admin });
  assert.equal(r.status, 200);
  const { rows: [m] } = await A.db.query('SELECT * FROM outbox_emails WHERE id = $1', [r.body.emailId]);
  assert.equal(m.kind, 'winner_notification_resend');
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  const eml = fs.readFileSync(m.file_path, 'utf8');
  assert.match(eml, /application\/pdf/);
  assert.match(eml, /Content-Disposition: attachment;\s*filename=/);
  assert.match(eml, /^JVBERi0/m, 'base64 PDF body (%PDF-) present');
  const ev = (await A.call('GET', `/api/admin/announcement-events?drawId=${drawn.id}`, { token: admin })).body;
  assert.ok(ev.rows.some((e) => e.event === 'winner_email_resent'));
  const logs = (await A.call('GET', `/api/admin/logs?drawId=${drawn.id}`, { token: admin })).body;
  assert.ok(JSON.stringify(logs).includes('winner_notification_resent'));
});

test('announcement visibility + social card only when public; consent controls the name', async () => {
  const drawn = (await A.call('GET', '/api/draws?status=drawn')).body[0];
  const card = await A.raw(`/api/draws/${drawn.id}/card.png`);
  assert.equal(card.status, 200);
  const png = Buffer.from(await card.arrayBuffer());
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  const share = await (await A.raw(`/share/draws/${drawn.id}`)).text();
  assert.match(share, /og:image" content="[^"]+\/card\.png/);
  const a = (await A.call('GET', `/api/draws/${drawn.id}/announcement`)).body;
  assert.match(a.winnerDisplay, /^\S\*\*\* \S\.$/);
  await A.call('POST', `/api/admin/draws/${drawn.id}/visibility`, { token: admin, body: { visibility: 'unlisted' } });
  assert.equal((await A.raw(`/api/draws/${drawn.id}/card.png`)).status, 404);
  assert.equal((await A.raw(`/share/draws/${drawn.id}`)).status, 404);
  assert.equal((await A.call('GET', `/api/draws/${drawn.id}/announcement`)).status, 200);
  await A.call('POST', `/api/admin/draws/${drawn.id}/visibility`, { token: admin, body: { visibility: 'organizer' } });
  assert.equal((await A.call('GET', `/api/draws/${drawn.id}/announcement`)).status, 404);
  assert.equal((await A.call('GET', `/api/draws/${drawn.id}/announcement`, { token: admin })).status, 200);
  await A.call('POST', `/api/admin/draws/${drawn.id}/visibility`, { token: admin, body: { visibility: 'public' } });
  const { rows: [w] } = await A.db.query('SELECT u.email, u.name FROM draws d JOIN users u ON u.id = d.winner_user_id WHERE d.id = $1', [drawn.id]);
  const wt = await A.login(w.email);
  assert.equal((await A.call('POST', `/api/me/wins/${drawn.id}/consent`, { token: admin, body: { showFullName: true } })).status, 404);
  await A.call('POST', `/api/me/wins/${drawn.id}/consent`, { token: wt, body: { showFullName: true } });
  assert.equal((await A.call('GET', `/api/draws/${drawn.id}/announcement`)).body.winnerDisplay, w.name);
});

test('reminders: skips and sends are logged; unsubscribe via link is honoured immediately and logged', async () => {
  const t = await A.login('ava@luckydraw.demo');
  const d = (await A.call('POST', '/api/admin/draws', { token: admin, body: { title: 'Reminder test', mode: 'equal', prizeCents: 100, entryPriceCents: 0, durationMinutes: 600 } })).body;
  await A.call('POST', `/api/draws/${d.id}/entries`, { token: t, body: { count: 5 } }); // Ava at cap
  const { rows: [ben] } = await A.db.query(`SELECT * FROM users WHERE email='ben@luckydraw.demo'`);
  const unsub = await A.raw(`/api/unsubscribe/${ben.unsubscribe_token}`, { redirect: 'manual' });
  assert.equal(unsub.status, 302);
  await processReminders(A.db, new Date());
  const log = (await A.call('GET', `/api/admin/reminders?drawId=${d.id}`, { token: admin })).body;
  const by = (email) => log.rows.find((r) => r.email === email && r.type === '24h')?.outcome;
  assert.equal(by('ava@luckydraw.demo'), 'skipped_at_cap');
  assert.equal(by('ben@luckydraw.demo'), 'skipped_unsubscribed');
  assert.equal(by('grace@luckydraw.demo'), 'skipped_unsubscribed');
  assert.equal(by('chloe@luckydraw.demo'), 'sent');
  assert.ok(log.rows.find((r) => r.email === 'chloe@luckydraw.demo').emailId);
  assert.ok(log.rows.every((r) => r.createdAtOrganizer));
  // Idempotent: a second pass adds nothing.
  await processReminders(A.db, new Date());
  assert.equal((await A.call('GET', `/api/admin/reminders?drawId=${d.id}`, { token: admin })).body.rows.length, log.rows.length);
  const pe = (await A.call('GET', '/api/admin/preference-events', { token: admin })).body;
  assert.ok(pe.some((e) => e.userId === ben.id && e.event === 'unsubscribed_all' && e.method === 'one_click_link'));
  // Dashboard opt-in is logged too.
  await A.call('PUT', '/api/me/preferences', { token: await A.login('ben@luckydraw.demo'), body: { remindersOptOut: false } });
  assert.ok((await A.call('GET', '/api/admin/preference-events', { token: admin })).body.some((e) => e.userId === ben.id && e.event === 'opted_in_all' && e.method === 'dashboard'));
  const csv = (await A.call('GET', `/api/admin/reminders/export.csv?drawId=${d.id}`, { token: admin })).text;
  assert.ok(csv.includes('skipped_at_cap') && csv.includes('# export_sha256,'));
});

test('schedules: weekly occurrences in organizer timezone; idempotent materialisation; fairness stack applied', async () => {
  const occ = occurrences({ freq: 'weekly', byWeekday: [5], time: '20:00' }, 'Africa/Nairobi', new Date('2026-10-17T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
  assert.deepEqual(occ.map((d) => d.toISOString()), ['2026-10-23T17:00:00.000Z', '2026-10-30T17:00:00.000Z']);
  const before = (await A.db.query('SELECT COUNT(*)::int n FROM draws WHERE schedule_id IS NOT NULL')).rows[0].n;
  await materializeSchedules(A.db); await materializeSchedules(A.db);
  assert.equal((await A.db.query('SELECT COUNT(*)::int n FROM draws WHERE schedule_id IS NOT NULL')).rows[0].n, before);
  const s = (await A.call('POST', '/api/admin/schedules', { token: admin, body: { name: 'Daily Noon', mode: 'weighted', prizeCents: 1000, rule: { freq: 'daily', time: '12:00' }, timezone: 'UTC', windowMinutes: 120, horizonDays: 3 } }));
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const { rows } = await A.db.query('SELECT * FROM draws WHERE schedule_id = $1 ORDER BY closes_at', [s.body.id]);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((d) => /^[0-9a-f]{64}$/.test(d.seed_commitment) && d.seed !== null));
  const bad = await A.call('POST', '/api/admin/schedules', { token: admin, body: { name: 'Bad', mode: 'equal', prizeCents: 1, rule: { freq: 'daily', time: '12:00' }, timezone: 'Mars/Base', windowMinutes: 60 } });
  assert.equal(bad.status, 400);
  // Scheduler opens, closes, seals and draws a scheduled occurrence.
  const first = rows[0];
  await schedulerPass(A.db, { now: new Date(new Date(first.opens_at).getTime() + 1000), anchors: false });
  assert.equal((await A.db.query('SELECT status FROM draws WHERE id = $1', [first.id])).rows[0].status, 'open');
});

test('public upcoming endpoint exposes only whitelisted fields', async () => {
  const items = (await A.call('GET', '/api/upcoming?weeks=8')).body;
  const ALLOWED = ['kind', 'drawId', 'title', 'mode', 'prizeCents', 'entryPriceCents', 'maxEntriesPerUser', 'opensAt', 'closesAt', 'entries', 'seedCommitment'].sort();
  assert.ok(items.length > 3);
  assert.ok(items.some((i) => i.kind === 'projected') && items.some((i) => i.kind === 'open') && items.some((i) => i.kind === 'scheduled'));
  for (const i of items) {
    assert.deepEqual(Object.keys(i).sort(), ALLOWED);
    if (i.kind !== 'open') assert.equal(i.seedCommitment, null);
  }
  const text = JSON.stringify(items);
  for (const banned of ['seed"', 'cron', 'rule', 'timezone', 'horizon', 'scheduleId', 'windowMinutes', '@luckydraw']) assert.ok(!text.includes(banned), banned);
});

test('compliance summary: one-page PDF + HTML preview with live stats', async () => {
  const r = await A.raw('/api/admin/compliance.pdf', { headers: { Authorization: `Bearer ${admin}` } });
  const pdf = Buffer.from(await r.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  const html = (await A.call('GET', '/api/admin/compliance.html', { token: admin })).text;
  assert.match(html, /not legal advice/i);
  assert.match(html, /Draws sealed/i);
});
