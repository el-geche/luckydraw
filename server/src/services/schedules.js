/**
 * Recurring draw schedules. Occurrence = the CLOSE time of a draw, expressed as a local
 * wall-clock rule in the schedule's IANA timezone. Entry window: opens = close − window.
 * Draws are materialised `horizon_days` ahead with status 'scheduled'; a UNIQUE index on
 * (schedule_id, occurrence_at) makes generation idempotent (safe on restart / concurrent ticks).
 * Occurrences whose close time has already passed are never created (no back-filling).
 */
import { badRequest, notFound } from '../errors.js';
import { createDraw } from './draws.js';
import { logEvent } from './logs.js';
import { iso } from '../util.js';

// ---------- timezone helpers ----------
function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
/** Local wall time in tz → UTC Date (two-pass offset correction; DST-safe for non-gap times). */
export function zonedToUtc(y, m, d, h, mi, tz) {
  let t = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(t), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    t += Date.UTC(y, m - 1, d, h, mi) - asUtc;
  }
  return new Date(t);
}
export function validTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// ---------- rules (weekly / monthly / cron "m h dom mon dow") ----------
function parseField(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    let [a, b] = range === '*' ? [min, max] : range.split('-').map(Number);
    if (b == null) b = stepS ? max : a;
    if (![a, b, step].every(Number.isInteger) || a < min || b > max || a > b || step < 1) throw badRequest(`Invalid cron field "${field}"`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}
export function ruleToCron(rule) {
  if (rule.freq === 'cron') return rule.cron;
  const [hh, mm] = String(rule.time || '20:00').split(':').map(Number);
  if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) throw badRequest('time must be HH:MM');
  if (rule.freq === 'weekly') {
    const days = (rule.byWeekday?.length ? rule.byWeekday : [5]).map(Number);
    return `${mm} ${hh} * * ${days.join(',')}`;
  }
  if (rule.freq === 'monthly') return `${mm} ${hh} ${(rule.byMonthDay?.length ? rule.byMonthDay : [1]).join(',')} * *`;
  if (rule.freq === 'daily') return `${mm} ${hh} * * *`;
  throw badRequest('freq must be daily, weekly, monthly or cron');
}
export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw badRequest('cron needs 5 fields: minute hour day-of-month month day-of-week');
  return { mi: parseField(f[0], 0, 59), h: parseField(f[1], 0, 23), dom: parseField(f[2], 1, 31), mon: parseField(f[3], 1, 12), dow: parseField(f[4].replace(/7/g, '0'), 0, 6), domStar: f[2] === '*', dowStar: f[4] === '*' };
}

/** Close-time occurrences (UTC) in [from, to). */
export function occurrences(rule, tz, from, to, limit = 500) {
  const c = parseCron(ruleToCron(rule));
  const out = [];
  const start = partsIn(from, tz);
  let day = Date.UTC(start.y, start.m - 1, start.d);
  const endMs = to.getTime() + 2 * 86400_000;
  for (; day <= endMs && out.length < limit; day += 86400_000) {
    const dt = new Date(day);
    const y = dt.getUTCFullYear(); const m = dt.getUTCMonth() + 1; const d = dt.getUTCDate(); const dow = dt.getUTCDay();
    if (!c.mon.has(m)) continue;
    const domOk = c.dom.has(d); const dowOk = c.dow.has(dow);
    const dayOk = c.domStar && c.dowStar ? true : c.domStar ? dowOk : c.dowStar ? domOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of [...c.h].sort((a, b) => a - b)) for (const mi of [...c.mi].sort((a, b) => a - b)) {
      const t = zonedToUtc(y, m, d, h, mi, tz);
      if (t >= from && t < to) out.push(t);
    }
  }
  return out.sort((a, b) => a - b).slice(0, limit);
}

export const titleFor = (s, closeAt) => s.title_template.replace('{date}', new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: s.timezone }).format(closeAt)).replace('{n}', '');

export function validateSchedule(input) {
  const s = {
    name: String(input.name || '').trim(), titleTemplate: String(input.titleTemplate || input.name || '').trim(), description: String(input.description || ''),
    mode: input.mode, prizeCents: Number(input.prizeCents), entryPriceCents: Number(input.entryPriceCents ?? 0), maxEntriesPerUser: Number(input.maxEntriesPerUser ?? 5),
    announcementVisibility: input.announcementVisibility || 'public', rule: input.rule, timezone: input.timezone || 'UTC', windowMinutes: Number(input.windowMinutes),
    reminderHours: Number(input.reminderHours ?? 24), shortNoticeHours: input.shortNoticeHours ? Number(input.shortNoticeHours) : null, horizonDays: Number(input.horizonDays ?? 14),
  };
  if (s.name.length < 3) throw badRequest('Schedule name is required');
  if (!['equal', 'weighted'].includes(s.mode)) throw badRequest('Mode must be equal or weighted');
  if (!Number.isInteger(s.prizeCents) || s.prizeCents < 0) throw badRequest('Invalid prize');
  if (!Number.isInteger(s.maxEntriesPerUser) || s.maxEntriesPerUser < 1 || s.maxEntriesPerUser > 5) throw badRequest('Entry cap must be 1–5');
  if (!['public', 'unlisted', 'organizer'].includes(s.announcementVisibility)) throw badRequest('Invalid visibility');
  if (!validTimezone(s.timezone)) throw badRequest('Unknown timezone');
  if (!Number.isInteger(s.windowMinutes) || s.windowMinutes < 5 || s.windowMinutes > 60 * 24 * 60) throw badRequest('Entry window must be 5 minutes – 60 days');
  if (!s.rule || typeof s.rule !== 'object') throw badRequest('Rule required');
  parseCron(ruleToCron(s.rule));
  if (!(s.horizonDays >= 1 && s.horizonDays <= 90)) throw badRequest('Horizon must be 1–90 days');
  return s;
}

export async function createSchedule(db, input, actor) {
  const s = validateSchedule(input);
  const { rows: [row] } = await db.query(
    `INSERT INTO draw_schedules (name, title_template, description, mode, prize_cents, entry_price_cents, max_entries_per_user, announcement_visibility, rule, timezone, window_minutes, reminder_hours, short_notice_hours, horizon_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14) RETURNING *`,
    [s.name, s.titleTemplate, s.description, s.mode, s.prizeCents, s.entryPriceCents, s.maxEntriesPerUser, s.announcementVisibility, JSON.stringify(s.rule), s.timezone, s.windowMinutes, s.reminderHours, s.shortNoticeHours, s.horizonDays]);
  await logEvent(db, { event: 'schedule_created', actor, details: { scheduleId: row.id, name: row.name } });
  return row;
}

/** Remove not-yet-open draws of a schedule (no seed commitment published, no entries). */
async function dropUnopened(db, scheduleId) {
  const { rows } = await db.query(`DELETE FROM draws WHERE schedule_id = $1 AND status = 'scheduled' RETURNING id`, [scheduleId]);
  return rows.length;
}

export async function updateSchedule(db, id, input, actor) {
  const { rows: [cur] } = await db.query('SELECT * FROM draw_schedules WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!cur) throw notFound('Schedule not found');
  const s = validateSchedule({ name: cur.name, titleTemplate: cur.title_template, description: cur.description, mode: cur.mode, prizeCents: cur.prize_cents, entryPriceCents: cur.entry_price_cents, maxEntriesPerUser: cur.max_entries_per_user, announcementVisibility: cur.announcement_visibility, rule: cur.rule, timezone: cur.timezone, windowMinutes: cur.window_minutes, reminderHours: cur.reminder_hours, shortNoticeHours: cur.short_notice_hours, horizonDays: cur.horizon_days, ...input });
  const { rows: [row] } = await db.query(
    `UPDATE draw_schedules SET name=$2, title_template=$3, description=$4, mode=$5, prize_cents=$6, entry_price_cents=$7, max_entries_per_user=$8, announcement_visibility=$9, rule=$10::jsonb, timezone=$11, window_minutes=$12, reminder_hours=$13, short_notice_hours=$14, horizon_days=$15, version=version+1, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, s.name, s.titleTemplate, s.description, s.mode, s.prizeCents, s.entryPriceCents, s.maxEntriesPerUser, s.announcementVisibility, JSON.stringify(s.rule), s.timezone, s.windowMinutes, s.reminderHours, s.shortNoticeHours, s.horizonDays]);
  // Edits apply to future draws only: open/closed/drawn draws are untouched; not-yet-open ones are regenerated.
  const dropped = await dropUnopened(db, id);
  await logEvent(db, { event: 'schedule_updated', actor, details: { scheduleId: id, version: row.version, regeneratedUnopened: dropped } });
  return row;
}

export async function setPaused(db, id, paused, actor) {
  const { rows: [row] } = await db.query('UPDATE draw_schedules SET paused=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *', [id, paused]);
  if (!row) throw notFound('Schedule not found');
  const dropped = paused ? await dropUnopened(db, id) : 0;
  await logEvent(db, { event: paused ? 'schedule_paused' : 'schedule_resumed', actor, details: { scheduleId: id, removedUnopened: dropped } });
  return row;
}

export async function deleteSchedule(db, id, actor) {
  const { rows: [row] } = await db.query('UPDATE draw_schedules SET deleted_at=now(), paused=true WHERE id=$1 AND deleted_at IS NULL RETURNING *', [id]);
  if (!row) throw notFound('Schedule not found');
  const dropped = await dropUnopened(db, id);
  await logEvent(db, { event: 'schedule_deleted', actor, details: { scheduleId: id, removedUnopened: dropped } });
  return row;
}

/** Idempotent materialisation of upcoming draws for every active schedule. */
export async function materializeSchedules(db, now = new Date()) {
  const { rows: scheds } = await db.query('SELECT * FROM draw_schedules WHERE paused = false AND deleted_at IS NULL');
  let created = 0;
  for (const s of scheds) {
    const occ = occurrences(s.rule, s.timezone, now, new Date(now.getTime() + s.horizon_days * 86400_000));
    for (const closeAt of occ) {
      const { rows: exists } = await db.query('SELECT 1 FROM draws WHERE schedule_id = $1 AND occurrence_at = $2', [s.id, closeAt]);
      if (exists.length) continue;
      const opensAt = new Date(closeAt.getTime() - s.window_minutes * 60000);
      try {
        await db.tx(async (q) => {
          const d = await createDraw(q, {
            title: titleFor(s, closeAt), description: s.description, mode: s.mode, prizeCents: s.prize_cents, entryPriceCents: s.entry_price_cents,
            maxEntriesPerUser: s.max_entries_per_user, autoDraw: true, opensAt, closesAt: closeAt,
          }, { actor: `schedule:${s.id}`, now, scheduled: opensAt > now });
          await q.query('UPDATE draws SET schedule_id=$2, occurrence_at=$3, announcement_visibility=$4, reminder_hours=$5, short_notice_hours=$6 WHERE id=$1',
            [d.id, s.id, closeAt, s.announcement_visibility, s.reminder_hours, s.short_notice_hours]);
        });
        created++;
      } catch (e) {
        if (!/duplicate key|unique/i.test(e.message)) throw e; // concurrent tick created it — fine
      }
    }
  }
  return { created };
}

/** Projected future occurrences beyond what has been materialised (public "upcoming" page). */
export async function projectedOccurrences(db, { now = new Date(), weeks = 8 } = {}) {
  const { rows: scheds } = await db.query('SELECT * FROM draw_schedules WHERE paused = false AND deleted_at IS NULL');
  const until = new Date(now.getTime() + weeks * 7 * 86400_000);
  const out = [];
  for (const s of scheds) {
    const { rows: made } = await db.query('SELECT occurrence_at FROM draws WHERE schedule_id = $1', [s.id]);
    const have = new Set(made.map((r) => new Date(r.occurrence_at).getTime()));
    for (const closeAt of occurrences(s.rule, s.timezone, now, until)) {
      if (have.has(closeAt.getTime())) continue;
      out.push({ scheduleId: s.id, title: titleFor(s, closeAt), mode: s.mode, prizeCents: s.prize_cents, entryPriceCents: s.entry_price_cents, maxEntriesPerUser: s.max_entries_per_user, opensAt: iso(new Date(closeAt.getTime() - s.window_minutes * 60000)), closesAt: iso(closeAt) });
    }
  }
  return out.sort((a, b) => a.closesAt.localeCompare(b.closesAt));
}

export const serializeSchedule = (s) => ({
  id: s.id, name: s.name, titleTemplate: s.title_template, description: s.description, mode: s.mode, prizeCents: s.prize_cents, entryPriceCents: s.entry_price_cents,
  maxEntriesPerUser: s.max_entries_per_user, announcementVisibility: s.announcement_visibility, rule: s.rule, cron: ruleToCron(s.rule), timezone: s.timezone,
  windowMinutes: s.window_minutes, reminderHours: s.reminder_hours, shortNoticeHours: s.short_notice_hours, horizonDays: s.horizon_days, paused: s.paused, version: s.version,
  createdAt: iso(s.created_at), updatedAt: iso(s.updated_at),
});
