export const money = (cents, { sign = false } = {}) => {
  const v = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = cents < 0 ? '−' : sign && cents > 0 ? '+' : '';
  return `${s}$${v}`;
};
export const pct = (p, digits = 1) => `${(p * 100).toFixed(digits)}%`;
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const dateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export const shortHash = (h, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : '—');
export const initials = (name) => name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
export const relative = (iso) => {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [['day', 86400000], ['hour', 3600000], ['minute', 60000]];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [u, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), u);
  return rtf.format(Math.round(diff / 1000), 'second');
};
export const utcTime = (iso) => (iso ? `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)} UTC` : '—');
export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
