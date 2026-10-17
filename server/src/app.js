import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { ALGORITHM, MAX_ENTRIES_PER_USER, MAX_TICKETS_PER_ENTRY } from '@luckydraw/shared';
import { optionalAuth, requireAuth, requireAdmin, signToken } from './auth.js';
import { HttpError, badRequest, unauthorized, conflict, notFound, forbidden } from './errors.js';
import { createDraw, enterDraw, closeDraw, executeDraw, serializeDraw, getDrawRow } from './services/draws.js';
import { getBalance, addTransaction, serializeTx, validateDepositAmount } from './services/wallet.js';
import { paymentsProvider } from './payments/index.js';
import { config } from './config.js';
import { DEMO_ACCOUNTS, REFERRER_BONUS_CENTS, REFEREE_BONUS_CENTS, WELCOME_BONUS_CENTS } from './demoAccounts.js';
import { seedDatabase } from './seed.js';
import { sendEntryReceiptEmail } from './services/receipts.js';
import { serializeEmail } from './mail/index.js';
import { registerExtraRoutes } from './routes/extra.js';
import { logAnnouncement } from './services/events.js';
import { afterDraw } from './services/lifecycle.js';
import { newUnsubscribeToken } from './services/reminders.js';
import { iso, publicName } from './util.js';
import { upsertUser } from './services/users.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const intParam = (v, label = 'id') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`Invalid ${label}`);
  return n;
};
const userOut = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, referralCode: u.referral_code, createdAt: iso(u.created_at) });

export function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(optionalAuth);
  app.use((_req, res, next) => { res.set('X-LuckyDraw-Demo', 'simulated-money-only'); next(); });

  // ---------- meta ----------
  app.get('/api/health', wrap(async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, db: db.kind, time: new Date().toISOString() });
  }));
  app.get('/api/meta', (_req, res) => res.json({
    demo: true, notice: 'DEMO — no real money. All balances, deposits and payouts are simulated.',
    algorithm: ALGORITHM, maxEntriesPerUser: MAX_ENTRIES_PER_USER, maxTicketsPerEntry: MAX_TICKETS_PER_ENTRY,
    paymentsProvider: paymentsProvider.name, db: db.kind, mailTransport: config.mail.transport, registrationMode: config.registrationMode,
  }));

  // ---------- auth ----------
  app.get('/api/auth/demo-accounts', (_req, res) => res.json(DEMO_ACCOUNTS.map(({ email, password, name, role }) => ({ email, password, name, role }))));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(String(req.body?.password || ''), u.password_hash))) throw unauthorized('Invalid email or password');
    res.json({ token: signToken(u), user: userOut(u) });
  }));

  app.post('/api/auth/register', wrap(async (req, res) => {
    if (config.registrationMode === 'closed') throw forbidden('Registration is closed');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const refCode = String(req.body?.referralCode || '').trim().toUpperCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw badRequest('A valid email is required');
    if (name.length < 2 || name.length > 60) throw badRequest('Name must be 2–60 characters');
    if (password.length < 6) throw badRequest('Password must be at least 6 characters');
    const user = await db.tx(async (q) => {
      const { rows: dupe } = await q.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (dupe.length) throw conflict('An account with that email already exists', 'EMAIL_TAKEN');
      let referrer = null;
      if (refCode) {
        const { rows } = await q.query('SELECT * FROM users WHERE referral_code = $1', [refCode]);
        if (!rows[0]) throw badRequest('Unknown referral code', 'BAD_REFERRAL');
        referrer = rows[0];
      }
      const code = `${name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'USER'}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const { rows: [u] } = await q.query(
        'INSERT INTO users (email, name, password_hash, role, referral_code, referred_by, unsubscribe_token) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [email, name, await bcrypt.hash(password, 8), 'member', code, referrer?.id ?? null, newUnsubscribeToken()]);
      await addTransaction(q, { userId: u.id, type: 'welcome_bonus', amountCents: WELCOME_BONUS_CENTS, description: 'Demo welcome credit' });
      if (referrer) {
        await addTransaction(q, { userId: u.id, type: 'referral_bonus', amountCents: REFEREE_BONUS_CENTS, description: `Referral welcome bonus (invited by ${referrer.name})` });
        await addTransaction(q, { userId: referrer.id, type: 'referral_bonus', amountCents: REFERRER_BONUS_CENTS, description: `Referral bonus — ${name} joined with your code` });
      }
      return u;
    });
    res.status(201).json({ token: signToken(user), user: userOut(user) });
  }));

  app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) throw unauthorized();
    res.json({ user: userOut(rows[0]), balanceCents: await getBalance(db, req.user.id) });
  }));

  // ---------- public draws ----------
  app.get('/api/draws', wrap(async (req, res) => {
    const status = req.query.status ? String(req.query.status).split(',') : null;
    const { rows } = await db.query(
      `SELECT * FROM draws ${status ? 'WHERE status = ANY($1)' : ''}
       ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END, COALESCE(drawn_at, closes_at) DESC`, status ? [status] : []);
    res.json(await Promise.all(rows.map((d) => serializeDraw(db, d))));
  }));

  app.get('/api/draws/:id', wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.id));
    res.json(await serializeDraw(db, d, { includeEntries: true, viewerId: req.user?.id ?? null }));
  }));

  app.get('/api/draws/:id/audit', wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.id));
    if (!d.result) throw notFound('Audit record is published once the draw has been run. Until then only the seed commitment is public.');
    res.json(d.result);
  }));

  app.post('/api/draws/:id/entries', requireAuth, wrap(async (req, res) => {
    const out = await enterDraw(db, { drawId: intParam(req.params.id), userId: req.user.id, count: req.body?.count ?? 1, tickets: req.body?.tickets ?? 1 });
    // The audit-trail record was appended inside the entry transaction; now render/send the confirmation.
    let email = null;
    try { email = await sendEntryReceiptEmail(db, out.receipt); } catch (e) { console.error('[mail] receipt email failed:', e.message); }
    res.status(201).json({
      ...out,
      entries: out.entries.map((e) => ({ entryId: e.id, tickets: e.tickets, createdAt: iso(e.created_at) })),
      receipt: { code: out.receipt.code, payloadHash: out.receipt.payload_hash, entryIds: out.receipt.entry_ids, createdAt: iso(out.receipt.created_at) },
      auditRecord: { drawSeq: out.record.drawSeq, recordHash: out.record.recordHash, prevHash: out.record.prevHash, deliveryChannel: out.record.deliveryChannel },
      email: email ? { id: email.id, transport: email.transport } : null,
    });
  }));

  // ---------- member ----------
  app.get('/api/me/dashboard', requireAuth, wrap(async (req, res) => {
    const uid = req.user.id;
    const [{ rows: [u] }, { rows: txs }, { rows: ent }] = await Promise.all([
      db.query('SELECT * FROM users WHERE id = $1', [uid]),
      db.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC', [uid]),
      db.query(`SELECT d.id AS draw_id, d.title, d.mode, d.status, d.prize_cents, d.closes_at, d.drawn_at, d.winner_user_id, d.winner_entry_id,
                       COUNT(e.id)::int AS entries, SUM(e.tickets)::int AS tickets, ARRAY_AGG(e.id ORDER BY e.id) AS entry_ids, MIN(e.created_at) AS first_entry_at
                FROM entries e JOIN draws d ON d.id = e.draw_id WHERE e.user_id = $1
                GROUP BY d.id ORDER BY MIN(e.created_at) DESC`, [uid]),
    ]);
    const { rows: referrals } = await db.query('SELECT name, created_at FROM users WHERE referred_by = $1 ORDER BY created_at', [uid]);
    const sum = (type, sign = 1) => txs.filter((t) => t.type === type).reduce((s, t) => s + sign * t.amount_cents, 0);
    res.json({
      demo: true,
      user: userOut(u),
      wallet: {
        balanceCents: txs.reduce((s, t) => s + t.amount_cents, 0),
        totals: { depositsCents: sum('deposit'), payoutsCents: sum('prize_payout'), referralBonusesCents: sum('referral_bonus'), welcomeCents: sum('welcome_bonus'), entryFeesCents: sum('entry_fee', -1) },
        transactions: txs.map(serializeTx),
        provider: paymentsProvider.name,
      },
      entries: ent.map((r) => ({
        drawId: r.draw_id, title: r.title, mode: r.mode, status: r.status, prizeCents: r.prize_cents, entries: r.entries, tickets: r.tickets,
        entryIds: r.entry_ids, closesAt: iso(r.closes_at), drawnAt: iso(r.drawn_at), firstEntryAt: iso(r.first_entry_at),
        outcome: r.status === 'drawn' ? (r.winner_user_id === uid ? 'won' : 'not_won') : r.status === 'void' ? 'void' : 'pending',
        winningEntryId: r.winner_user_id === uid ? r.winner_entry_id : null,
      })),
      referrals: { code: u.referral_code, referred: referrals.map((r) => ({ name: publicName(r.name), joinedAt: iso(r.created_at) })), bonusPerReferralCents: REFERRER_BONUS_CENTS },
    });
  }));

  app.get('/api/me/outbox', requireAuth, wrap(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM outbox_emails WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200', [req.user.id]);
    res.json(rows.map((e) => serializeEmail(e)));
  }));
  app.get('/api/me/outbox/:id', requireAuth, wrap(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM outbox_emails WHERE id = $1', [intParam(req.params.id)]);
    const e = rows[0];
    if (!e || (e.user_id !== req.user.id && req.user.role !== 'admin')) throw notFound('Email not found');
    if (e.user_id === req.user.id && e.kind.startsWith('winner_notification') && e.draw_id) {
      const { rows: seen } = await db.query(`SELECT 1 FROM announcement_events WHERE email_id = $1 AND event = 'winner_email_opened_demo'`, [e.id]);
      if (!seen.length) await logAnnouncement(db, { drawId: e.draw_id, userId: e.user_id, event: 'winner_email_opened_demo', actor: 'demo-outbox', emailId: e.id, details: { approximate: true, note: 'opened in the in-app demo outbox' } });
    }
    res.json(serializeEmail(e, { full: true }));
  }));

  app.post('/api/me/wallet/deposit', requireAuth, wrap(async (req, res) => {
    const amountCents = Number(req.body?.amountCents);
    validateDepositAmount(amountCents);
    const charge = await paymentsProvider.charge({ amountCents, userId: req.user.id });
    const tx = await addTransaction(db, { userId: req.user.id, type: 'deposit', amountCents, provider: charge.provider, providerRef: charge.ref,
      description: charge.provider === 'stripe-test' ? 'Stripe TEST-mode deposit (no real money)' : 'Simulated deposit (demo card •••• 4242)' });
    res.status(201).json({ transaction: serializeTx(tx), balanceCents: await getBalance(db, req.user.id) });
  }));

  // ---------- admin ----------
  const admin = express.Router();
  admin.use(requireAdmin);
  admin.get('/draws', wrap(async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM draws ORDER BY id DESC');
    res.json(await Promise.all(rows.map((d) => serializeDraw(db, d, { admin: true }))));
  }));
  admin.post('/draws', wrap(async (req, res) => {
    const d = await db.tx((q) => createDraw(q, req.body || {}, { actor: `admin:${req.user.name}`, actorId: req.user.id }));
    res.status(201).json(await serializeDraw(db, d, { admin: true }));
  }));
  admin.post('/draws/:id/close', wrap(async (req, res) => {
    const d = await closeDraw(db, intParam(req.params.id), { actor: `admin:${req.user.name}` });
    res.json(await serializeDraw(db, d, { admin: true }));
  }));
  admin.post('/draws/:id/run', wrap(async (req, res) => {
    try {
      const { audit } = await executeDraw(db, intParam(req.params.id), { actor: `admin:${req.user.name}` });
      await afterDraw(db, audit);
      res.json(audit);
    } catch (e) {
      if (e.code === 'ENTROPY_PENDING') return res.status(202).json({ pending: true, message: e.message, ...e.extra });
      throw e;
    }
  }));
  admin.get('/entries', wrap(async (req, res) => {
    const drawId = req.query.drawId ? intParam(req.query.drawId, 'drawId') : null;
    const { rows } = await db.query(
      `SELECT e.id, e.draw_id, e.user_id, e.tickets, e.created_at, u.name, u.email, d.title, d.mode, d.status, d.winner_entry_id
       FROM entries e JOIN users u ON u.id = e.user_id JOIN draws d ON d.id = e.draw_id
       ${drawId ? 'WHERE e.draw_id = $1' : ''} ORDER BY e.id DESC LIMIT 500`, drawId ? [drawId] : []);
    res.json(rows.map((r) => ({ entryId: r.id, drawId: r.draw_id, drawTitle: r.title, mode: r.mode, drawStatus: r.status, userId: r.user_id, name: r.name, email: r.email, tickets: r.tickets, createdAt: iso(r.created_at), won: r.winner_entry_id === r.id })));
  }));
  admin.get('/logs', wrap(async (req, res) => {
    const drawId = req.query.drawId ? intParam(req.query.drawId, 'drawId') : null;
    const { rows } = await db.query(
      `SELECT l.*, d.title FROM draw_logs l LEFT JOIN draws d ON d.id = l.draw_id ${drawId ? 'WHERE l.draw_id = $1' : ''} ORDER BY l.created_at DESC, l.id DESC LIMIT 500`, drawId ? [drawId] : []);
    res.json(rows.map((r) => ({ id: r.id, drawId: r.draw_id, drawTitle: r.title, event: r.event, actor: r.actor, details: r.details, createdAt: iso(r.created_at) })));
  }));
  admin.get('/users', wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT u.*, COALESCE((SELECT SUM(amount_cents) FROM wallet_transactions w WHERE w.user_id = u.id),0)::int AS balance,
              (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id)::int AS entry_count FROM users u ORDER BY u.id`);
    res.json(rows.map((u) => ({ ...userOut(u), balanceCents: u.balance, entryCount: u.entry_count })));
  }));
  // Create/update a real (non-demo) account; used by `npm run create-user` when the server holds the database.
  admin.post('/users', wrap(async (req, res) => {
    const u = await upsertUser(db, { email: req.body?.email, name: req.body?.name, role: req.body?.role, password: req.body?.password });
    res.status(u.created ? 201 : 200).json(u);
  }));
  admin.get('/outbox', wrap(async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM outbox_emails ORDER BY created_at DESC, id DESC LIMIT 300');
    res.json(rows.map((e) => serializeEmail(e)));
  }));
  admin.post('/reset', wrap(async (_req, res) => {
    await seedDatabase(db, { log: console.log });
    res.json({ ok: true });
  }));
  app.use('/api/admin', admin);

  registerExtraRoutes(app, db);
  app.use('/api', (_req, _res, next) => next(notFound('Unknown API route')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    if (err?.name === 'DrawEngineError') return res.status(400).json({ error: err.message, code: err.code });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON', code: 'BAD_JSON' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
  });
  return app;
}
