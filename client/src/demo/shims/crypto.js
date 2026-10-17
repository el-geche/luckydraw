/** node:crypto subset for the browser demo backend (SHA-256, HMAC-SHA256, randomBytes). */
import { Buffer } from './buffer-patch.js';
import { sha256Bytes, hmacSha256Bytes, utf8 } from '@luckydraw/shared';

const toBytes = (d, enc) => (typeof d === 'string' ? (enc && enc !== 'utf8' ? new Uint8Array(Buffer.from(d, enc)) : utf8(d)) : new Uint8Array(d));
const cat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const out = (bytes, enc) => (enc ? Buffer.from(bytes).toString(enc) : Buffer.from(bytes));

export function createHash(alg) {
  if (String(alg).toLowerCase() !== 'sha256') throw new Error(`Hash ${alg} is not available in the browser demo`);
  const parts = [];
  const h = { update(d, enc) { parts.push(toBytes(d, enc)); return h; }, digest(enc) { return out(sha256Bytes(cat(parts)), enc); } };
  return h;
}
export function createHmac(alg, key) {
  if (String(alg).toLowerCase() !== 'sha256') throw new Error(`HMAC ${alg} is not available in the browser demo`);
  const parts = [];
  const h = { update(d, enc) { parts.push(toBytes(d, enc)); return h; }, digest(enc) { return out(hmacSha256Bytes(toBytes(key), cat(parts)), enc); } };
  return h;
}
export function randomBytes(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return Buffer.from(b); }
export const randomUUID = () => globalThis.crypto.randomUUID();
export function randomInt(a, b) { const [min, max] = b === undefined ? [0, a] : [a, b]; const r = new Uint32Array(1); globalThis.crypto.getRandomValues(r); return min + (r[0] % (max - min)); }
export function timingSafeEqual(a, b) { if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length'); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
export default { createHash, createHmac, randomBytes, randomUUID, randomInt, timingSafeEqual };
