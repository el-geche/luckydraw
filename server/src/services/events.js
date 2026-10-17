/** Winner-announcement delivery/engagement events (admin log). No raw IPs are ever stored. */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { iso } from '../util.js';

export const ANNOUNCEMENT_EVENTS = ['winner_email_queued', 'winner_email_delivered_demo', 'winner_email_accepted_smtp', 'winner_email_failed', 'winner_email_bounced', 'winner_email_opened', 'winner_email_opened_demo', 'winner_email_resent', 'visibility_changed', 'consent_changed', 'report_downloaded', 'card_fetched'];

/** Keyed hash of the client IP (HMAC with the server secret) — enables de-duplication without storing IPs. */
export const hashIp = (ip) => (ip ? crypto.createHmac('sha256', config.jwtSecret).update(String(ip)).digest('hex').slice(0, 16) : null);

export async function logAnnouncement(q, { drawId, userId = null, event, actor = 'system', emailId = null, details = {}, now = new Date() }) {
  await q.query('INSERT INTO announcement_events (draw_id, user_id, event, actor, email_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)', [drawId, userId, event, actor, emailId, JSON.stringify(details), now]);
}

export async function queryAnnouncementEvents(db, { drawId, userId, from, to, event } = {}) {
  const where = []; const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (drawId) add('e.draw_id = ?', Number(drawId));
  if (userId) add('e.user_id = ?', Number(userId));
  if (from) add('e.created_at >= ?', new Date(from));
  if (to) add('e.created_at <= ?', new Date(to));
  if (event) add('e.event = ?', String(event));
  const { rows } = await db.query(`SELECT e.*, d.title, u.name FROM announcement_events e JOIN draws d ON d.id = e.draw_id LEFT JOIN users u ON u.id = e.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.created_at DESC, e.id DESC LIMIT 5000`, params);
  return rows.map((r) => ({ id: r.id, drawId: r.draw_id, drawTitle: r.title, userId: r.user_id, member: r.name, event: r.event, actor: r.actor, emailId: r.email_id, details: r.details, createdAt: iso(r.created_at), approximate: r.event.startsWith('winner_email_opened') }));
}
