import { sha256 } from '../util.js';
import { badRequest } from '../errors.js';

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const intParam = (v, label = 'id') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`Invalid ${label}`);
  return n;
};
const csvCell = (v) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Send rows as hashed JSON or CSV (same hashing convention as the draw audit exports). */
export function sendExport(res, { name, format, rows, columns, meta = {} }) {
  if (format === 'csv') {
    const lines = Object.entries(meta).map(([k, v]) => `# ${k},${csvCell(v)}`);
    lines.push(columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')));
    const body = `${lines.join('\n')}\n`;
    const h = sha256(body);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'X-Export-SHA256': h });
    return res.send(`${body}# export_sha256,${h}\n`);
  }
  const content = { ...meta, count: rows.length, rows };
  const h = sha256(JSON.stringify(content));
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.json"`, 'X-Export-SHA256': h });
  return res.send(JSON.stringify({ exportSha256: h, hashAlgorithm: 'sha256(JSON.stringify(content))', content }, null, 2));
}

/** Tiny fixed-window in-memory rate limiter keyed by client IP (IPs are never persisted). */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, Math.max(windowMs, 1000)).unref();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n += 1;
    res.set({ 'RateLimit-Limit': String(max), 'RateLimit-Remaining': String(Math.max(0, max - h.n)) });
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many receipt lookups. Please wait a minute and try again.', code: 'RATE_LIMITED' });
    }
    return next();
  };
}
