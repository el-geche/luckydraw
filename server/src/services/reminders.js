/**
 * Entry reminders. For every open draw and every member, at most ONE decision per
 * (draw, member, type) is ever recorded (UNIQUE constraint) — sent or skipped — so the
 * job is idempotent across restarts and concurrent ticks.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { sendMail } from '../mail/index.js';
import { iso } from '../util.js';

const fmt = (c) => `$${(c / 100).toFixed(2)}`;
export const newUnsubscribeToken = () => crypto.randomBytes(18).toString('base64url');
const fmtTz = (d, tz) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz, timeZoneName: 'short' }).format(d);

async function decide(db, { draw, user, type, now }) {
  // Reserve the decision slot first (idempotency); losers of a race simply stop here.
  const { rows: [slot] } = await db.query(
    `INSERT INTO reminder_log (draw_id, user_id, type, outcome, created_at) VALUES ($1,$2,$3,'failed',$4) ON CONFLICT (draw_id, user_id, type) DO NOTHING RETURNING id`,
    [draw.id, user.id, type, now]);
  if (!slot) return null;
  const finish = (outcome, extra = {}) => db.query('UPDATE reminder_log SET outcome=$2, channel=$3, email_id=$4, details=$5::jsonb WHERE id=$1',
    [slot.id, outcome, extra.channel ?? null, extra.emailId ?? null, JSON.stringify(extra.details ?? {})]).then(() => outcome);
  const { rows: [d] } = await db.query('SELECT status, closes_at FROM draws WHERE id = $1', [draw.id]);
  if (d.status !== 'open' || new Date(d.closes_at) <= now) return finish('skipped_draw_closed');
  if (user.reminders_opt_out) return finish(user.reminders_opt_out_method === 'dashboard' ? 'skipped_opted_out' : 'skipped_unsubscribed', { details: { method: user.reminders_opt_out_method } });
  if (type === 'short_notice' && user.short_notice_opt_out) return finish('skipped_opted_out', { details: { scope: 'short_notice' } });
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM entries WHERE draw_id = $1 AND user_id = $2', [draw.id, user.id]);
  if (n >= draw.max_entries_per_user) return finish('skipped_at_cap', { details: { entries: n } });
  try {
    const closes = new Date(draw.closes_at);
    const enterUrl = `${config.appUrl}/draws/${draw.id}`;
    const unsubUrl = `${config.appUrl}/api/unsubscribe/${user.unsubscribe_token}`;
    const when = `${fmtTz(closes, user.timezone || 'UTC')} (${closes.toISOString().replace('T', ' ').slice(0, 16)} UTC)`;
    const label = type === '24h' ? `${draw.reminder_hours}-hour reminder` : 'Short-notice reminder';
    const subject = `[DEMO] ${label}: “${draw.title}” closes ${type === '24h' ? 'soon' : 'shortly'}`;
    const text = [`LuckyDraw — DEMO PLATFORM. No real money.`, '', `Hi ${user.name.split(' ')[0]},`, '', `"${draw.title}" (draw #${draw.id}) closes ${when}.`,
      `Prize: ${fmt(draw.prize_cents)} (demo credits)`, `Your entries: ${n} of ${draw.max_entries_per_user}`, '', `Enter: ${enterUrl}`, '', `Unsubscribe from all reminders (one click): ${unsubUrl}`].join('\n');
    const html = `<!doctype html><html><body style="margin:0;background:#0a1222;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e5eaf3">
<div style="background:#2a2210;color:#e9d39c;text-align:center;font-size:12px;padding:8px"><b style="letter-spacing:.12em">DEMO PLATFORM</b> · No real money</div>
<div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="font-size:20px;font-weight:700"><span style="color:#c9a24a">●</span> LuckyDraw</div>
<div style="background:#111c34;border:1px solid rgba(148,163,184,.18);border-radius:14px;padding:26px;margin-top:18px">
<div style="color:#c9a24a;text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:600">${label}</div>
<h1 style="font-size:22px;margin:8px 0">${draw.title} closes ${type === '24h' ? 'soon' : 'shortly'}</h1>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin:10px 0">
<tr><td style="color:#8b98ae;padding:6px 0;width:130px">Closes</td><td>${when}</td></tr>
<tr><td style="color:#8b98ae;padding:6px 0">Prize</td><td>${fmt(draw.prize_cents)} <span style="color:#e6c77f">(demo credits)</span></td></tr>
<tr><td style="color:#8b98ae;padding:6px 0">Your entries</td><td>${n} of ${draw.max_entries_per_user}</td></tr></table>
<a href="${enterUrl}" style="display:inline-block;background:#c9a24a;color:#14100a;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px;font-size:14px">Enter the draw</a></div>
<p style="color:#8b98ae;font-size:12px;margin-top:16px">You receive reminders because reminders are enabled on your demo account. <a href="${unsubUrl}" style="color:#e6c77f">Unsubscribe from all reminders</a> (one click, no login) or manage preferences in your dashboard.</p></div></body></html>`;
    const mail = await sendMail(db, { userId: user.id, to: user.email, subject, html, text, kind: `reminder_${type}`, drawId: draw.id, now,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    return finish('sent', { channel: mail.transport === 'smtp' ? 'smtp' : 'demo_outbox', emailId: mail.id, details: { entries: n } });
  } catch (e) {
    return finish('failed', { details: { error: String(e.message).slice(0, 300) } });
  }
}

/** Scheduler job: evaluate due reminders. */
export async function processReminders(db, now = new Date()) {
  const { rows: draws } = await db.query(`SELECT * FROM draws WHERE status = 'open' AND closes_at > $1`, [now]);
  const { rows: members } = await db.query(`SELECT * FROM users WHERE role = 'member' ORDER BY id`);
  const results = [];
  for (const draw of draws) {
    const msLeft = new Date(draw.closes_at) - now;
    const types = [];
    if (msLeft <= draw.reminder_hours * 3600_000) types.push('24h');
    if (draw.short_notice_hours && msLeft <= draw.short_notice_hours * 3600_000) types.push('short_notice');
    for (const type of types) for (const user of members) {
      const outcome = await decide(db, { draw, user, type, now });
      if (outcome) results.push({ drawId: draw.id, userId: user.id, type, outcome });
    }
  }
  return results;
}

export async function setPreferences(db, userId, { remindersOptOut, shortNoticeOptOut, method }) {
  const { rows: [u] } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  const events = [];
  if (remindersOptOut != null && Boolean(remindersOptOut) !== u.reminders_opt_out) {
    await db.query('UPDATE users SET reminders_opt_out = $2, reminders_opt_out_method = $3 WHERE id = $1', [userId, Boolean(remindersOptOut), remindersOptOut ? method : null]);
    events.push(remindersOptOut ? (method === 'dashboard' ? 'opted_out_all' : 'unsubscribed_all') : 'opted_in_all');
  }
  if (shortNoticeOptOut != null && Boolean(shortNoticeOptOut) !== u.short_notice_opt_out) {
    await db.query('UPDATE users SET short_notice_opt_out = $2 WHERE id = $1', [userId, Boolean(shortNoticeOptOut)]);
    events.push(shortNoticeOptOut ? 'opted_out_short_notice' : 'opted_in_short_notice');
  }
  for (const e of events) await db.query('INSERT INTO preference_events (user_id, event, method) VALUES ($1,$2,$3)', [userId, e, method]);
  return events;
}

export async function queryReminderLog(db, { drawId, userId, from, to, type, outcome } = {}) {
  const where = []; const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (drawId) add('r.draw_id = ?', Number(drawId));
  if (userId) add('r.user_id = ?', Number(userId));
  if (from) add('r.created_at >= ?', new Date(from));
  if (to) add('r.created_at <= ?', new Date(to));
  if (type) add('r.type = ?', String(type));
  if (outcome) add('r.outcome = ?', String(outcome));
  const { rows } = await db.query(`SELECT r.*, d.title, u.name, u.email FROM reminder_log r JOIN draws d ON d.id = r.draw_id JOIN users u ON u.id = r.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC, r.id DESC LIMIT 5000`, params);
  const fmt = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: config.organizerTimezone, timeZoneName: 'short' });
  const local = (d) => fmt.format(d);
  return rows.map((r) => ({ id: r.id, drawId: r.draw_id, drawTitle: r.title, userId: r.user_id, member: r.name, email: r.email, type: r.type, outcome: r.outcome, channel: r.channel, emailId: r.email_id, details: r.details, createdAt: iso(r.created_at), createdAtOrganizer: local(new Date(r.created_at)) }));
}

export async function queryPreferenceEvents(db, { userId, from, to } = {}) {
  const where = []; const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (userId) add('p.user_id = ?', Number(userId));
  if (from) add('p.created_at >= ?', new Date(from));
  if (to) add('p.created_at <= ?', new Date(to));
  const { rows } = await db.query(`SELECT p.*, u.name FROM preference_events p JOIN users u ON u.id = p.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC LIMIT 5000`, params);
  return rows.map((r) => ({ id: r.id, userId: r.user_id, member: r.name, event: r.event, method: r.method, createdAt: iso(r.created_at) }));
}
