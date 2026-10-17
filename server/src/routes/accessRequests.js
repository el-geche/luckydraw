/**
 * Invite-only access requests (public landing page).
 *  POST /api/access-requests        public; validated, honeypot, light per-IP rate limit. Never creates an account.
 *  GET  /api/admin/access-requests  admin only.
 * A notification is queued to the demo outbox (addressed to the organiser) for each accepted request.
 */
import { requireAdmin } from '../auth.js';
import { badRequest } from '../errors.js';
import { sendMail } from '../mail/index.js';
import { iso } from '../util.js';
import { wrap } from './helpers.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ACCESS_REQUEST_CONFIRMATION = 'Thanks — your request has been received. The organiser reviews every request personally and will contact you by email if an invitation is issued. Please note: this does not create an account, and you cannot sign in until you are invited.';

// Railway (and most PaaS proxies) append the real client address as the last X-Forwarded-For hop.
const clientKey = (req) => {
  const xff = String(req.headers?.['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] || req.ip || req.socket?.remoteAddress || 'unknown';
};

function limiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    const key = clientKey(req);
    let h = hits.get(key);
    if (!h) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n += 1;
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests from your network. Please try again later.', code: 'RATE_LIMITED' });
    }
    return next();
  };
}

const serialize = (r) => ({ id: r.id, name: r.name, email: r.email, message: r.message, status: r.status, emailId: r.email_id, createdAt: iso(r.created_at) });

export function registerAccessRequestRoutes(app, db, {
  windowMs = Number(process.env.ACCESS_REQUEST_RATE_WINDOW_MS || 60 * 60_000),
  max = Number(process.env.ACCESS_REQUEST_RATE_MAX || 5),
  notifyTo = process.env.ACCESS_REQUEST_NOTIFY_TO || 'organiser@luckydraw.demo',
} = {}) {
  app.post('/api/access-requests', limiter({ windowMs, max }), wrap(async (req, res) => {
    const b = req.body || {};
    // Honeypot: real visitors never see or fill the "website" field. Pretend success, store nothing.
    if (String(b.website || '').trim()) return res.status(202).json({ ok: true, message: ACCESS_REQUEST_CONFIRMATION, accountCreated: false });
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const email = String(b.email || '').trim().toLowerCase();
    const message = String(b.message || '').trim();
    if (name.length < 2 || name.length > 80) throw badRequest('Please enter your name (2–80 characters).', 'BAD_NAME');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw badRequest('Please enter a valid email address.', 'BAD_EMAIL');
    if (message.length > 500) throw badRequest('Please keep your message under 500 characters.', 'BAD_MESSAGE');

    const { rows: [row] } = await db.query(
      'INSERT INTO access_requests (name, email, message) VALUES ($1,$2,$3) RETURNING *', [name, email, message || null]);
    try {
      const mail = await sendMail(db, {
        to: notifyTo, kind: 'access_request',
        subject: `Access request #${row.id}: ${name}`,
        text: `New LuckyDraw access request\n\nName: ${name}\nEmail: ${email}\nMessage: ${message || '(none)'}\n\nNo account has been created. Invite this person with \`npm run create-user\` if approved.`,
        html: `<div style="font-family:Inter,Arial,sans-serif;color:#0b1324"><h2 style="margin:0 0 12px">New access request #${row.id}</h2><p><strong>Name:</strong> ${esc(name)}<br><strong>Email:</strong> ${esc(email)}</p><p><strong>Message:</strong><br>${message ? esc(message).replace(/\n/g, '<br>') : '<em>(none)</em>'}</p><p style="color:#64748b;font-size:13px">No account has been created. Invite this person with <code>npm run create-user</code> if approved.</p></div>`,
      });
      await db.query('UPDATE access_requests SET email_id = $1 WHERE id = $2', [mail.id, row.id]);
    } catch (err) {
      console.error('[access-requests] notification failed', err?.message);
    }
    res.status(201).json({ ok: true, id: row.id, message: ACCESS_REQUEST_CONFIRMATION, accountCreated: false });
  }));

  app.get('/api/admin/access-requests', requireAdmin, wrap(async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM access_requests ORDER BY created_at DESC, id DESC LIMIT 500');
    res.json(rows.map(serialize));
  }));
}
