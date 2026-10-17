// Globals the server modules expect (Node): Buffer and process.env. Loaded before any server module.
import { Buffer } from './shims/buffer-patch.js';

globalThis.Buffer ??= Buffer;
const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
globalThis.process ??= { env: {}, versions: {}, platform: 'browser', cwd: () => '/', nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)) };
globalThis.__LD_ENV__ ??= {};
globalThis.process.env = globalThis.__LD_ENV__;
Object.assign(globalThis.__LD_ENV__, {
  NODE_ENV: 'production',
  ALLOW_DEMO_RESET: 'true',        // static demo: the in-browser database is per-visitor and disposable
  MAIL_TRANSPORT: 'none',          // in-app outbox table only; nothing leaves the browser
  ANCHOR_PROVIDERS: 'none',        // no external anchoring from visitors' browsers
  ENTROPY_PROVIDER: 'drand',       // public drand beacon (read-only HTTPS GET); falls back to "none" if unreachable
  ENTROPY_FALLBACK_MS: '90000',
  APP_URL: `${globalThis.location?.origin ?? ''}${base}`,
  PGLITE_DIR: 'idb://luckydraw-demo',
  JWT_SECRET: deviceSecret(),
});

function deviceSecret() {
  try {
    let s = localStorage.getItem('luckydraw.demo.secret');
    if (!s) { const b = new Uint8Array(32); crypto.getRandomValues(b); s = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('luckydraw.demo.secret', s); }
    return s;
  } catch { return 'luckydraw-browser-demo'; }
}
