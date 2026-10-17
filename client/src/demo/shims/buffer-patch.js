// The `buffer` polyfill (v6) lacks Node's "base64url" encoding; add it.
import { Buffer } from 'buffer';

if (!Buffer.isEncoding('base64url')) {
  const toStr = Buffer.prototype.toString;
  Buffer.prototype.toString = function toString(enc, ...rest) {
    if (String(enc).toLowerCase() === 'base64url') return toStr.call(this, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return toStr.call(this, enc, ...rest);
  };
  const from = Buffer.from;
  Buffer.from = function fromPatched(v, enc, ...rest) {
    if (typeof v === 'string' && String(enc).toLowerCase() === 'base64url') return from.call(Buffer, v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return from.call(Buffer, v, enc, ...rest);
  };
  const isEnc = Buffer.isEncoding;
  Buffer.isEncoding = (e) => String(e).toLowerCase() === 'base64url' || isEnc(e);
}
export { Buffer };
