/** HS256 JWT sign/verify for the browser demo (same token format as jsonwebtoken). */
import { Buffer } from './buffer-patch.js';
import { hmacSha256Bytes, utf8 } from '@luckydraw/shared';

const b64u = (b) => Buffer.from(b).toString('base64url');
const dur = (v) => (typeof v === 'number' ? v : (() => { const m = /^(\d+)\s*([smhd])$/.exec(String(v)); return m ? Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : Number(v); })());
export function sign(payload, secret, opts = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, ...(opts.expiresIn ? { exp: iat + dur(opts.expiresIn) } : {}) };
  const data = `${b64u(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))}.${b64u(utf8(JSON.stringify(body)))}`;
  return `${data}.${b64u(hmacSha256Bytes(utf8(secret), utf8(data)))}`;
}
export function verify(token, secret) {
  const [h, p, s] = String(token).split('.');
  if (!s || b64u(hmacSha256Bytes(utf8(secret), utf8(`${h}.${p}`))) !== s) throw new Error('invalid signature');
  const body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (body.exp && body.exp < Date.now() / 1000) throw new Error('jwt expired');
  return body;
}
export default { sign, verify };
