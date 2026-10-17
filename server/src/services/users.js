/** Real (non-demo) account management used by `npm run create-user` and POST /api/admin/users. */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { badRequest } from '../errors.js';
import { newUnsubscribeToken } from './reminders.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 6;

/**
 * Create or update an account. The password is hashed with bcrypt (cost 10) and never stored or logged in clear.
 * Accounts created this way are flagged keep_on_reseed, so `npm run seed` / admin "Reset demo data" keep them.
 */
export async function upsertUser(db, { email, name, role = 'member', password }) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw badRequest('A valid email is required');
  if (!['member', 'admin'].includes(role)) throw badRequest('Role must be member or admin');
  if (String(password || '').length < MIN_PASSWORD) throw badRequest(`Password must be at least ${MIN_PASSWORD} characters`);
  name = String(name || '').trim() || (role === 'admin' ? 'Organizer' : 'Member');
  const hash = await bcrypt.hash(String(password), 10);
  const code = `${name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'USER'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email, name, password_hash, role, referral_code, unsubscribe_token, keep_on_reseed)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, keep_on_reseed = true
     RETURNING id, email, name, role, (xmax = 0) AS created`,
    [email, name, hash, role, code, newUnsubscribeToken()]);
  return { id: u.id, email: u.email, name: u.name, role: u.role, created: u.created };
}
