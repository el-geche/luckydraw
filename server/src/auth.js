import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { unauthorized, forbidden } from './errors.js';

export const signToken = (user) => jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, { expiresIn: '7d' });

/** Attaches req.user when a valid Bearer token is present (never rejects). */
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
