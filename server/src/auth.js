import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { unauthorized, forbidden } from './errors.js';

export const signToken = (user) => jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, { expiresIn: '7d' });

/**
 * Attaches req.user when a valid Bearer token is present (never rejects by itself).
 * With a db, the user is re-loaded on every request: a token for a deleted user is ignored (protected routes
 * then answer 401) and the role always comes from the database, never from the token.
 * Without a db (legacy callers) the verified token claims are used as before.
 */
export function authFromDb(db) {
  return async (req, _res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return next();
    let p;
    try { p = jwt.verify(h.slice(7), config.jwtSecret); } catch { return next(); }
    const id = Number(p.sub);
    if (!Number.isInteger(id) || id < 1) return next();
    try {
      const { rows: [u] } = await db.query('SELECT id, role, name FROM users WHERE id = $1', [id]);
      if (u) req.user = { id: u.id, role: u.role, name: u.name };
      else req.authError = 'USER_NOT_FOUND';
      return next();
    } catch (e) { return next(e); }
  };
}
export function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const p = jwt.verify(h.slice(7), config.jwtSecret);
      req.user = { id: Number(p.sub), role: p.role, name: p.name };
    } catch { /* ignore invalid token */ }
  }
  next();
}
export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));
export const requireAdmin = (req, _res, next) => (!req.user ? next(unauthorized()) : req.user.role !== 'admin' ? next(forbidden()) : next());
