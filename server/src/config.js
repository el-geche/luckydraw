import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'luckydraw-dev-secret-not-for-production',
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: process.env.PGSSL === 'true',
  pgliteDir: process.env.PGLITE_DIR || path.resolve(here, '..', '.data', 'pglite'),
  paymentsProvider: process.env.PAYMENTS_PROVIDER || 'simulated',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  outboxDir: process.env.OUTBOX_DIR || path.resolve(here, '..', '.data', 'outbox'),
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  mail: {
    transport: process.env.MAIL_TRANSPORT || 'outbox',
    from: process.env.MAIL_FROM || '"LuckyDraw Demo" <no-reply@luckydraw.demo>',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 2000),
};

// Public entropy mixed into the final seed: "drand" (default) or "none".
config.entropy = {
  provider: process.env.ENTROPY_PROVIDER || 'drand',
  drandUrl: (process.env.DRAND_URL || 'https://api.drand.sh').replace(/\/$/, ''),
  drandGenesis: Number(process.env.DRAND_GENESIS || 1595431050),
  drandPeriod: Number(process.env.DRAND_PERIOD || 30),
  // If the beacon cannot be fetched this long after its round time, draw with entropy "none" (recorded).
  fallbackAfterMs: Number(process.env.ENTROPY_FALLBACK_MS || 10 * 60_000),
};
// External anchoring of commitments and seals. Comma list of: opentimestamps, rfc3161, webhook. "none" disables.
config.anchors = {
  providers: (process.env.ANCHOR_PROVIDERS ?? 'opentimestamps').split(',').map((s) => s.trim()).filter((s) => s && s !== 'none'),
  otsCalendars: (process.env.OTS_CALENDARS || 'https://a.pool.opentimestamps.org,https://b.pool.opentimestamps.org,https://a.pool.eternitywall.com').split(',').map((s) => s.trim()).filter(Boolean),
  tsaUrl: process.env.TSA_URL || 'https://freetsa.org/tsr',
  webhookUrl: process.env.ANCHOR_WEBHOOK_URL || '',
  retryMs: Number(process.env.ANCHOR_RETRY_MS || 60_000),
  upgradeMs: Number(process.env.ANCHOR_UPGRADE_MS || 30 * 60_000),
  timeoutMs: Number(process.env.ANCHOR_TIMEOUT_MS || 10_000),
};
config.receiptRateLimit = { windowMs: Number(process.env.RECEIPT_RATE_WINDOW_MS || 60_000), max: Number(process.env.RECEIPT_RATE_MAX || 20) };
config.organizerTimezone = process.env.ORGANIZER_TZ || 'Africa/Nairobi';
// Open tracking for winner emails: only when SMTP is configured AND explicitly enabled. Off by default.
config.openTracking = process.env.MAIL_OPEN_TRACKING === 'true';
config.mailWebhookSecret = process.env.MAIL_WEBHOOK_SECRET || '';
// Public self-service sign-up: "open" (default; local dev, static demo, tests) or "closed" (hosted backends:
// accounts are created by the organiser with `npm run create-user`). Read on each access so it can be toggled in tests.
Object.defineProperty(config, 'registrationMode', {
  enumerable: true,
  get: () => (String(process.env.REGISTRATION_MODE || 'open').trim().toLowerCase() === 'closed' ? 'closed' : 'open'),
});
