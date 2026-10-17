/** qrcode.toBuffer() for the browser: render with the package's browser build, return PNG bytes. */
import { Buffer } from './buffer-patch.js';
import QR from 'qrcode/lib/browser.js';

export async function toBuffer(text, opts = {}) {
  const url = await QR.toDataURL(text, { ...opts, type: 'image/png' });
  return Buffer.from(url.split(',')[1], 'base64');
}
export const toDataURL = (...a) => QR.toDataURL(...a);
export default { toBuffer, toDataURL };
