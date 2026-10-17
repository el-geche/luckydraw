// Static preview mode (e.g. GitHub Pages): the Express API + database are not available.
// Enabled at build time with VITE_STATIC_PREVIEW=1, or detected at runtime when /api is unreachable.
export const STATIC_PREVIEW = import.meta.env.VITE_STATIC_PREVIEW === '1';
export const BASE = import.meta.env.BASE_URL || '/';
export const asset = (p) => `${BASE}${p.replace(/^\//, '')}`;

let unreachable = STATIC_PREVIEW;
const listeners = new Set();
export const isBackendUnavailable = () => unreachable;
export function markBackendUnavailable() {
  if (unreachable) return;
  unreachable = true;
  listeners.forEach((fn) => fn(true));
}
export function onBackendStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
