/** Routes for the fairness stack: chain, anchors, bundle, reports, announcements, cards,
 *  receipts, reminders, preferences, schedules, logs and compliance. */
import express from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { notFound, conflict, badRequest, unauthorized } from '../errors.js';
import { wrap, intParam, sendExport, rateLimit } from './helpers.js';
import { getDrawRow, serializeDraw } from '../services/draws.js';
import { publicChain, verifyAllChains, queryLedger, checkReceiptInChain, LEDGER_COLUMNS, fromRow } from '../services/ledger.js';
import { drawAnchors, processAnchors, upgradeAnchors } from '../services/anchors.js';
import { buildReportData, renderReportPdf } from '../services/report.js';
import { renderCard, invalidateCard, shortVerifyUrl, cardWinnerName } from '../services/card.js';
import { notifyWinner, announcementAccess } from '../services/winner.js';
import { logAnnouncement, queryAnnouncementEvents, hashIp } from '../services/events.js';
import { lookupReceipt } from '../services/receipts.js';
import { processReminders, setPreferences, queryReminderLog, queryPreferenceEvents } from '../services/reminders.js';
import { createSchedule, updateSchedule, setPaused, deleteSchedule, serializeSchedule, projectedOccurrences, materializeSchedules } from '../services/schedules.js';
import { complianceStats, complianceHtml, compliancePdf } from '../services/compliance.js';
import { buildJsonExport, buildCsvExport } from '../services/exports.js';
import { maskName, iso, publicName } from '../util.js';
import { serializeEmail } from '../mail/index.js';
import { logEvent } from '../services/logs.js';

const SOURCES = new Set(['results', 'verify', 'admin', 'announcement', 'email', 'other']);

export function registerExtraRoutes(app, db) {
  const sealedOr404 = async (id) => {
    const d = await getDrawRow(db, intParam(id));
    if (!d.sealed_at) throw notFound('Published once the draw is sealed (at close).');
    return d;
  };
  const drawnOr404 = async (id) => {
    const d = await getDrawRow(db, intParam(id));
    if (d.status !== 'drawn' && d.status !== 'void') throw notFound('Published once the draw has been sealed and run.');
    return d;
  };

  // ---------- public: chain, anchors, bundle ----------
  app.get('/api/draws/:id/chain.json', wrap(async (req, res) => {
    const d = await sealedOr404(req.params.id);
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="luckydraw-draw-${d.id}-chain.json"`);
    res.json(await publicChain(db, d));
  }));
  app.get('/api/draws/:id/anchors', wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.id));
    res.json(await drawAnchors(db, d.id));
  }));
  app.get('/api/draws/:id/anchors/:aid/proof.:fmt', wrap(async (req, res) => {
    const { rows: [a] } = await db.query('SELECT * FROM draw_anchors WHERE id = $1 AND draw_id = $2', [intParam(req.params.aid), intParam(req.params.id)]);
    if (!a?.proof_b64 || a.proof_format !== req.params.fmt) throw notFound('No proof stored for this anchor yet');
    res.set({ 'Content-Type': a.proof_format === 'ots' ? 'application/vnd.opentimestamps.v1' : 'application/timestamp-reply', 'Content-Disposition': `attachment; filename="luckydraw-draw-${a.draw_id}-${a.kind}.${a.proof_format}"` });
    res.send(Buffer.from(a.proof_b64, 'base64'));
  }));
  app.get('/api/draws/:id/verification-bundle', wrap(async (req, res) => {
    const d = await drawnOr404(req.params.id);
    res.json({ audit: d.result, chain: await publicChain(db, d), anchors: await drawAnchors(db, d.id, { withProof: true }) });
  }));
  // Audit exports now bundle the chain + anchors (proofs included).
  const bundleExtras = async (d) => ({ chain: await publicChain(db, d), anchors: await drawAnchors(db, d.id, { withProof: true }) });
  app.get('/api/draws/:id/export.json', wrap(async (req, res) => {
    const d = await drawnOr404(req.params.id);
    const { body, sha256 } = buildJsonExport(d.result, await bundleExtras(d));
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="luckydraw-draw-${d.id}-audit.json"`, 'X-Export-SHA256': sha256 });
    res.send(body);
  }));
  app.get('/api/draws/:id/export.csv', wrap(async (req, res) => {
    const d = await drawnOr404(req.params.id);
    const { body, sha256 } = buildCsvExport(d.result, await bundleExtras(d));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="luckydraw-draw-${d.id}-audit.csv"`, 'X-Export-SHA256': sha256 });
    res.send(body);
  }));
  app.get('/api/draws/:id/export-hashes', wrap(async (req, res) => {
    const d = await drawnOr404(req.params.id);
    const ex = await bundleExtras(d);
    res.json({ json: buildJsonExport(d.result, ex).sha256, csv: buildCsvExport(d.result, ex).sha256 });
  }));

  // ---------- fairness report PDF ----------
  app.get('/api/draws/:id/report.pdf', wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.id));
    const pdf = await renderReportPdf(await buildReportData(db, d));
    const source = SOURCES.has(String(req.query.source)) ? String(req.query.source) : 'other';
    await logAnnouncement(db, { drawId: d.id, userId: req.user?.id ?? null, event: 'report_downloaded', actor: req.user ? `user:${req.user.id}` : 'public', details: { source, ipHash: hashIp(req.ip), status: d.status } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.inline ? 'inline' : 'attachment'}; filename="luckydraw-fairness-report-draw-${d.id}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }));

  // ---------- winner announcement ----------
  const announcementData = async (d) => {
    const r = d.result;
    const { rows: [w] } = await db.query('SELECT name FROM users WHERE id = $1', [d.winner_user_id]);
    const anchors = await drawAnchors(db, d.id);
    const sealAnchor = anchors.find((a) => a.kind === 'seal' && a.provider === 'opentimestamps') ?? anchors.find((a) => a.kind === 'seal') ?? null;
    return {
      drawId: d.id, title: d.title, mode: d.mode, prizeCents: d.prize_cents, drawnAt: iso(d.drawn_at), visibility: d.announcement_visibility,
      winningNumber: r.ticket, totalWeight: r.totalWeight, winnerEntryId: r.winnerEntryId,
      winnerDisplay: d.winner_show_full_name ? w?.name ?? null : maskName(w?.name ?? 'Anonymous'), winnerConsentFullName: d.winner_show_full_name,
      seal: { hash: d.seal_hash, count: d.seal_count, sealedAt: iso(d.sealed_at) },
      anchor: sealAnchor ? { provider: sealAnchor.provider, status: sealAnchor.status, bitcoinBlock: sealAnchor.bitcoinBlock, submittedAt: sealAnchor.submittedAt } : null,
      verifyUrl: `/verify/${d.id}`, shortVerifyUrl: shortVerifyUrl(d.id), reportUrl: `/api/draws/${d.id}/report.pdf?source=announcement`,
      cardUrl: d.announcement_visibility === 'public' ? `/api/draws/${d.id}/card.png` : null, shareUrl: d.announcement_visibility === 'public' ? `${config.appUrl.replace(/:5173$/, `:${config.port}`)}/share/draws/${d.id}` : null,
    };
  };
  app.get('/api/draws/:id/announcement', wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.id));
    const acc = announcementAccess(d, req.user);
    if (!acc.visible) throw notFound('No announcement available for this draw.');
    res.json(await announcementData(d));
  }));
  app.get('/api/draws/:id/card.png', wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.id));
    if (d.status !== 'drawn' || !d.sealed_at || d.announcement_visibility !== 'public') throw notFound('No public announcement card for this draw.');
    const { rows: [w] } = await db.query('SELECT name FROM users WHERE id = $1', [d.winner_user_id]);
    const anchors = await drawAnchors(db, d.id);
    const st = anchors.find((a) => a.kind === 'seal')?.status;
    const png = await renderCard(d, { winnerName: w?.name, anchorStatus: st });
    if (req.query.log !== '0') await logAnnouncement(db, { drawId: d.id, event: 'card_fetched', actor: 'public', details: { ipHash: hashIp(req.ip), ua: String(req.get('user-agent') || '').slice(0, 60) } });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', ETag: `"card-${d.id}-${d.announcement_visibility}-${d.winner_show_full_name}"` });
    res.send(png);
  }));
  // Server-rendered share page with Open Graph / Twitter meta for crawlers (public only).
  app.get('/share/draws/:id', wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.id)).catch(() => null);
    if (!d || d.status !== 'drawn' || !d.sealed_at || d.announcement_visibility !== 'public') return res.status(404).type('html').send('<!doctype html><title>Not found</title><p>Announcement not found.</p>');
    const a = await announcementData(d);
    const base = `${req.protocol}://${req.get('host')}`;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const title = `${d.title} — winning number ${a.winningNumber}`;
    const desc = `Sealed & independently verifiable LuckyDraw result (demo). Recompute it yourself: ${a.shortVerifyUrl}`;
    const target = `${config.appUrl}/draws/${d.id}/winner`;
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${base}/api/draws/${d.id}/card.png?log=0"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${base}/share/draws/${d.id}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${base}/api/draws/${d.id}/card.png?log=0">
<meta http-equiv="refresh" content="0; url=${esc(target)}"></head><body><p><a href="${esc(target)}">View the announcement</a></p></body></html>`);
  }));

  // ---------- public receipt verification (rate limited) ----------
  const receiptLimiter = rateLimit(config.receiptRateLimit);
  app.get('/api/receipts/:code', receiptLimiter, wrap(async (req, res) => {
    const r = await lookupReceipt(db, req.params.code, { verifyChainForDraw: (drawId, code) => checkReceiptInChain(db, drawId, code) });
    res.status(r.found ? 200 : 404).json(r);
  }));

  // ---------- public upcoming draws (strict field whitelist) ----------
  app.get('/api/upcoming', wrap(async (req, res) => {
    const weeks = Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26);
    const now = new Date();
    const { rows } = await db.query(`SELECT * FROM draws WHERE status IN ('scheduled','open') AND closes_at > $1 ORDER BY closes_at`, [now]);
    const counts = new Map((await db.query(`SELECT draw_id, COUNT(*)::int AS n FROM entries GROUP BY draw_id`)).rows.map((r) => [r.draw_id, r.n]));
    const items = rows.map((d) => ({
      kind: d.status === 'open' ? 'open' : 'scheduled', drawId: d.id, title: d.title, mode: d.mode, prizeCents: d.prize_cents, entryPriceCents: d.entry_price_cents,
      maxEntriesPerUser: d.max_entries_per_user, opensAt: iso(d.opens_at), closesAt: iso(d.closes_at), entries: counts.get(d.id) ?? 0,
      seedCommitment: d.status === 'open' ? d.seed_commitment : null,
    }));
    const projected = (await projectedOccurrences(db, { now, weeks })).map((p) => ({
      kind: 'projected', drawId: null, title: p.title, mode: p.mode, prizeCents: p.prizeCents, entryPriceCents: p.entryPriceCents,
      maxEntriesPerUser: p.maxEntriesPerUser, opensAt: p.opensAt, closesAt: p.closesAt, entries: 0, seedCommitment: null,
    }));
    const until = new Date(now.getTime() + weeks * 7 * 86400_000).toISOString();
    res.json([...items, ...projected].filter((x) => x.closesAt <= until || x.kind === 'open').sort((a, b) => a.closesAt.localeCompare(b.closesAt)));
  }));

  // ---------- one-click unsubscribe (no login) ----------
  const unsubscribe = async (token, method) => {
    const { rows: [u] } = await db.query('SELECT id FROM users WHERE unsubscribe_token = $1', [String(token)]);
    if (!u) return false;
    await setPreferences(db, u.id, { remindersOptOut: true, method });
    return true;
  };
  app.get('/api/unsubscribe/:token', wrap(async (req, res) => {
    const ok = await unsubscribe(req.params.token, 'one_click_link');
    res.redirect(302, `${config.appUrl}/unsubscribed?ok=${ok ? 1 : 0}`);
  }));
  app.post('/api/unsubscribe/:token', express.urlencoded({ extended: false }), wrap(async (req, res) => {
    const ok = await unsubscribe(req.params.token, 'list_unsubscribe_post'); // RFC 8058 one-click
    res.status(ok ? 200 : 404).json({ ok });
  }));

  // ---------- open tracking pixel (only issued when SMTP + MAIL_OPEN_TRACKING=true) ----------
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  app.get('/api/t/open/:token.gif', wrap(async (req, res) => {
    const { rows: [e] } = await db.query('SELECT id, user_id, draw_id FROM outbox_emails WHERE track_token = $1', [req.params.token]);
    if (e) await logAnnouncement(db, { drawId: e.draw_id, userId: e.user_id, event: 'winner_email_opened', actor: 'pixel', emailId: e.id, details: { approximate: true } });
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }).send(GIF);
  }));
  // Bounce / delivery webhook from an SMTP provider (only if MAIL_WEBHOOK_SECRET is set).
  app.post('/api/webhooks/mail-events', wrap(async (req, res) => {
    if (!config.mailWebhookSecret || req.get('x-webhook-secret') !== config.mailWebhookSecret) throw unauthorized('Webhook not configured');
    const { messageId, event, detail } = req.body || {};
    const { rows: [e] } = await db.query('SELECT id, user_id, draw_id FROM outbox_emails WHERE message_id = $1', [String(messageId)]);
    if (!e) throw notFound('Unknown message');
    const ev = event === 'bounce' ? 'winner_email_bounced' : event === 'open' ? 'winner_email_opened' : 'winner_email_accepted_smtp';
    await logAnnouncement(db, { drawId: e.draw_id, userId: e.user_id, event: ev, actor: 'smtp-webhook', emailId: e.id, details: { detail: String(detail || '').slice(0, 300) } });
    res.json({ ok: true });
  }));

  // ---------- member ----------
  app.get('/api/me/receipts', requireAuth, wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT l.*, d.status, d.seal_hash FROM confirmation_ledger l JOIN draws d ON d.id = l.draw_id WHERE l.user_id = $1 ORDER BY l.id DESC`, [req.user.id]);
    const mails = new Map((await db.query(`SELECT id, receipt_code FROM outbox_emails WHERE user_id = $1 AND kind = 'entry_receipt'`, [req.user.id])).rows.map((m) => [m.receipt_code, m.id]));
    res.json(rows.map((r) => ({ ...fromRow(r), identitySalt: undefined, userEmail: undefined, drawStatus: r.status, sealed: Boolean(r.seal_hash), emailId: mails.get(r.receipt_code) ?? null })));
  }));
  app.get('/api/me/preferences', requireAuth, wrap(async (req, res) => {
    const { rows: [u] } = await db.query('SELECT reminders_opt_out, reminders_opt_out_method, short_notice_opt_out, timezone FROM users WHERE id = $1', [req.user.id]);
    const events = await queryPreferenceEvents(db, { userId: req.user.id });
    res.json({ remindersOptOut: u.reminders_opt_out, method: u.reminders_opt_out_method, shortNoticeOptOut: u.short_notice_opt_out, timezone: u.timezone, history: events.slice(0, 20) });
  }));
  app.put('/api/me/preferences', requireAuth, wrap(async (req, res) => {
    const { remindersOptOut, shortNoticeOptOut, timezone } = req.body || {};
    if (timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw badRequest('Unknown timezone'); }
      await db.query('UPDATE users SET timezone = $2 WHERE id = $1', [req.user.id, timezone]);
    }
    const events = await setPreferences(db, req.user.id, { remindersOptOut, shortNoticeOptOut, method: 'dashboard' });
    res.json({ ok: true, events });
  }));
  app.post('/api/me/wins/:drawId/consent', requireAuth, wrap(async (req, res) => {
    const d = await getDrawRow(db, intParam(req.params.drawId));
    if (d.winner_user_id !== req.user.id) throw notFound('You did not win this draw');
    const show = Boolean(req.body?.showFullName);
    await db.query('UPDATE draws SET winner_show_full_name = $2 WHERE id = $1', [d.id, show]);
    invalidateCard(d.id);
    await logAnnouncement(db, { drawId: d.id, userId: req.user.id, event: 'consent_changed', actor: `user:${req.user.id}`, details: { showFullName: show } });
    res.json({ ok: true, showFullName: show });
  }));

  // ---------- admin ----------
  const admin = express.Router();
  admin.use(requireAdmin);
  const actor = (req) => `admin:${req.user.name}`;
  const ledgerFilters = (q) => ({ drawId: q.drawId, userId: q.userId, from: q.from, to: q.to, q: q.q });

  admin.get('/ledger', wrap(async (req, res) => res.json(await queryLedger(db, ledgerFilters(req.query)))));
  admin.get('/ledger/verify', wrap(async (_req, res) => res.json(await verifyAllChains(db))));
  admin.get('/ledger/export.:fmt', wrap(async (req, res) => {
    const rows = (await queryLedger(db, { ...ledgerFilters(req.query), limit: 20000 })).reverse();
    const v = await verifyAllChains(db);
    sendExport(res, { name: 'luckydraw-entry-audit-trail', format: req.params.fmt, rows, columns: LEDGER_COLUMNS, meta: { format: 'luckydraw-entry-audit-trail v1', exportedAt: new Date().toISOString(), filters: JSON.stringify(ledgerFilters(req.query)), chainVerified: v.ok, chainHeads: JSON.stringify(v.draws.map((d) => ({ drawId: d.drawId, finalHash: d.finalHash, count: d.count }))) } });
  }));
  admin.get('/ledger/:id/email', wrap(async (req, res) => {
    const { rows: [l] } = await db.query('SELECT receipt_code FROM confirmation_ledger WHERE id = $1', [intParam(req.params.id)]);
    if (!l) throw notFound('Record not found');
    const { rows: [e] } = await db.query(`SELECT * FROM outbox_emails WHERE receipt_code = $1 AND kind = 'entry_receipt' ORDER BY id LIMIT 1`, [l.receipt_code]);
    if (!e) throw notFound('No rendered email stored for this record');
    res.json(serializeEmail(e, { full: true }));
  }));

  admin.post('/anchors/process', wrap(async (_req, res) => { await processAnchors(db, new Date(Date.now() + 365 * 86400_000)); res.json({ ok: true }); }));
  admin.post('/anchors/upgrade', wrap(async (req, res) => res.json(await upgradeAnchors(db, { drawId: req.query.drawId ? intParam(req.query.drawId) : null }))));
  admin.get('/anchors', wrap(async (_req, res) => {
    const { rows } = await db.query('SELECT a.*, d.title FROM draw_anchors a JOIN draws d ON d.id = a.draw_id ORDER BY a.id DESC');
    res.json(rows.map((a) => ({ ...(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'proof_b64'))), hasProof: Boolean(a.proof_b64) })));
  }));

  admin.post('/draws/:id/visibility', wrap(async (req, res) => {
    const v = String(req.body?.visibility);
    if (!['public', 'unlisted', 'organizer'].includes(v)) throw badRequest('visibility must be public, unlisted or organizer');
    const d = await getDrawRow(db, intParam(req.params.id));
    await db.query('UPDATE draws SET announcement_visibility = $2 WHERE id = $1', [d.id, v]);
    invalidateCard(d.id);
    await logAnnouncement(db, { drawId: d.id, event: 'visibility_changed', actor: actor(req), details: { from: d.announcement_visibility, to: v } });
    res.json({ ok: true, visibility: v });
  }));
  admin.post('/draws/:id/notify-winner', wrap(async (req, res) => {
    const m = await notifyWinner(db, intParam(req.params.id), { actor: actor(req), resend: true });
    res.json({ ok: true, emailId: m.id, transport: m.transport });
  }));

  admin.get('/reminders', wrap(async (req, res) => {
    const rows = await queryReminderLog(db, req.query);
    const summary = rows.reduce((s, r) => ({ ...s, [r.outcome]: (s[r.outcome] ?? 0) + 1 }), {});
    res.json({ summary, rows, organizerTimezone: config.organizerTimezone });
  }));
  admin.get('/reminders/export.:fmt', wrap(async (req, res) => sendExport(res, { name: 'luckydraw-reminder-log', format: req.params.fmt, rows: await queryReminderLog(db, req.query), columns: ['id', 'createdAt', 'createdAtOrganizer', 'drawId', 'drawTitle', 'userId', 'member', 'type', 'outcome', 'channel', 'emailId', 'details'], meta: { format: 'luckydraw-reminder-log v1', organizerTimezone: config.organizerTimezone, exportedAt: new Date().toISOString() } })));
  admin.post('/reminders/run', wrap(async (_req, res) => res.json(await processReminders(db))));
  admin.get('/preference-events', wrap(async (req, res) => res.json(await queryPreferenceEvents(db, req.query))));
  admin.get('/preference-events/export.:fmt', wrap(async (req, res) => sendExport(res, { name: 'luckydraw-preference-events', format: req.params.fmt, rows: await queryPreferenceEvents(db, req.query), columns: ['id', 'createdAt', 'userId', 'member', 'event', 'method'] })));

  admin.get('/announcement-events', wrap(async (req, res) => {
    const rows = await queryAnnouncementEvents(db, req.query);
    const summary = rows.reduce((s, r) => ({ ...s, [r.event]: (s[r.event] ?? 0) + 1 }), {});
    res.json({ summary, rows });
  }));
  admin.get('/announcement-events/export.:fmt', wrap(async (req, res) => sendExport(res, { name: 'luckydraw-announcement-log', format: req.params.fmt, rows: await queryAnnouncementEvents(db, req.query), columns: ['id', 'createdAt', 'drawId', 'drawTitle', 'userId', 'member', 'event', 'actor', 'emailId', 'approximate', 'details'], meta: { note: 'Opens are approximate: mail clients block or pre-fetch tracking pixels. No raw IPs stored.' } })));

  admin.get('/schedules', wrap(async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM draw_schedules WHERE deleted_at IS NULL ORDER BY id');
    res.json(rows.map(serializeSchedule));
  }));
  admin.post('/schedules', wrap(async (req, res) => { const s = await createSchedule(db, req.body || {}, actor(req)); await materializeSchedules(db); res.status(201).json(serializeSchedule(s)); }));
  admin.put('/schedules/:id', wrap(async (req, res) => { const s = await updateSchedule(db, intParam(req.params.id), req.body || {}, actor(req)); await materializeSchedules(db); res.json(serializeSchedule(s)); }));
  admin.post('/schedules/:id/pause', wrap(async (req, res) => res.json(serializeSchedule(await setPaused(db, intParam(req.params.id), true, actor(req))))));
  admin.post('/schedules/:id/resume', wrap(async (req, res) => { const s = await setPaused(db, intParam(req.params.id), false, actor(req)); await materializeSchedules(db); res.json(serializeSchedule(s)); }));
  admin.delete('/schedules/:id', wrap(async (req, res) => res.json(serializeSchedule(await deleteSchedule(db, intParam(req.params.id), actor(req))))));
  admin.get('/calendar', wrap(async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 45 * 86400_000);
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 70 * 86400_000);
    const { rows } = await db.query('SELECT d.*, s.name AS schedule_name FROM draws d LEFT JOIN draw_schedules s ON s.id = d.schedule_id WHERE d.closes_at BETWEEN $1 AND $2 ORDER BY d.closes_at', [from, to]);
    const projected = await projectedOccurrences(db, { now: new Date(), weeks: Math.ceil((to - Date.now()) / (7 * 86400_000)) });
    res.json({ draws: rows.map((d) => ({ id: d.id, title: d.title, status: d.status, mode: d.mode, prizeCents: d.prize_cents, opensAt: iso(d.opens_at), closesAt: iso(d.closes_at), scheduleId: d.schedule_id, scheduleName: d.schedule_name })), projected });
  }));

  admin.get('/compliance.pdf', wrap(async (_req, res) => {
    const pdf = await compliancePdf({ stats: await complianceStats(db), generatedAt: new Date().toISOString() });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="luckydraw-compliance-summary.pdf"' }).send(pdf);
  }));
  admin.get('/compliance.html', wrap(async (_req, res) => res.type('html').send(complianceHtml({ stats: await complianceStats(db), generatedAt: new Date().toISOString() }))));

  app.use('/api/admin', admin);
}
