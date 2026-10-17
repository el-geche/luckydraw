import crypto from 'node:crypto';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newSeed = () => crypto.randomBytes(32).toString('hex');
/** Public display name: "Ava Mensah" -> "Ava M." */
export const publicName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};
export const iso = (d) => (d ? new Date(d).toISOString() : null);
/** Strongly masked public name: "Ava Mensah" -> "A*** M." (used on public receipt pages and the audit chain). */
export const maskName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  const first = `${parts[0][0].toUpperCase()}***`;
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
};
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)
/** Non-guessable receipt code: 80 random bits, e.g. LD-7K2Q-M9XD-3HPA-W4TN. */
export const randomReceiptCode = () => {
  const bytes = crypto.randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 16; i++) { s = B32[Number(bits & 31n)] + s; bits >>= 5n; }
  return `LD-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
};
