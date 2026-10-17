CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  referral_code TEXT NOT NULL UNIQUE,
  referred_by   INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draws (
  id                   SERIAL PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  mode                 TEXT NOT NULL CHECK (mode IN ('equal', 'weighted')),
  status               TEXT NOT NULL CHECK (status IN ('open', 'closed', 'drawn', 'void')),
  prize_cents          INTEGER NOT NULL CHECK (prize_cents >= 0),
  entry_price_cents    INTEGER NOT NULL CHECK (entry_price_cents >= 0),
  max_entries_per_user INTEGER NOT NULL DEFAULT 5 CHECK (max_entries_per_user BETWEEN 1 AND 5),
  auto_draw            BOOLEAN NOT NULL DEFAULT false,
  seed                 TEXT NOT NULL,          -- secret until the draw is run
  seed_commitment      TEXT NOT NULL,          -- sha256(seed), public from opening
  opens_at             TIMESTAMPTZ NOT NULL,
  closes_at            TIMESTAMPTZ NOT NULL,
  closed_at            TIMESTAMPTZ,
  drawn_at             TIMESTAMPTZ,
  winner_entry_id      INTEGER,
  winner_user_id       INTEGER REFERENCES users(id),
  result               JSONB,                  -- published audit record
  created_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id         SERIAL PRIMARY KEY,
  draw_id    INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  tickets    INTEGER NOT NULL DEFAULT 1 CHECK (tickets BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entries_draw_user_idx ON entries (draw_id, user_id);

-- Every amount is SIMULATED demo money. Balance = SUM(amount_cents).
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL CHECK (type IN ('deposit', 'welcome_bonus', 'entry_fee', 'prize_payout', 'referral_bonus')),
  amount_cents INTEGER NOT NULL,
  description  TEXT NOT NULL,
  draw_id      INTEGER REFERENCES draws(id) ON DELETE SET NULL,
  provider     TEXT NOT NULL DEFAULT 'simulated',
  provider_ref TEXT,
  simulated    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON wallet_transactions (user_id);

CREATE TABLE IF NOT EXISTS draw_logs (
  id         SERIAL PRIMARY KEY,
  draw_id    INTEGER REFERENCES draws(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'system',
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS draw_logs_draw_idx ON draw_logs (draw_id);

-- Proof-of-entry receipts (one per purchase). code is derived from a sha256 of the receipt payload.
CREATE TABLE IF NOT EXISTS entry_receipts (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  draw_id      INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  entry_ids    INTEGER[] NOT NULL,
  tickets      INTEGER NOT NULL,
  cost_cents   INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dev mail outbox: every email the platform "sends" is recorded here (and written to server/.data/outbox).
CREATE TABLE IF NOT EXISTS outbox_emails (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  html         TEXT NOT NULL,
  text         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'entry_receipt',
  draw_id      INTEGER REFERENCES draws(id) ON DELETE SET NULL,
  receipt_code TEXT,
  transport    TEXT NOT NULL,
  message_id   TEXT,
  file_path    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_user_idx ON outbox_emails (user_id);

-- Entry-confirmation audit trail: append-only, one hash chain PER DRAW.
--   genesis      = sha256("luckydraw-ledger-v1|draw:<id>|<seed_commitment>")
--   record_hash  = sha256(JSON.stringify(public hashed fields incl. prev_hash))   (shared/src/ledger.js)
--   prev_hash    = record_hash of the previous record in the same draw (or genesis)
-- Records are appended in the same DB transaction as the entries (draw row locked), so the
-- chain is sealed consistently when the draw closes. Identity is only committed publicly:
--   identity_commitment = sha256("<user_id>|<lower(email)>|<identity_salt>")
CREATE TABLE IF NOT EXISTS confirmation_ledger (
  id                  SERIAL PRIMARY KEY,
  draw_id             INTEGER NOT NULL,
  draw_seq            INTEGER NOT NULL,
  created_at_iso      TEXT NOT NULL,
  user_id             INTEGER NOT NULL,
  user_name           TEXT NOT NULL,
  user_email          TEXT NOT NULL,
  identity_salt       TEXT NOT NULL,
  user_display        TEXT NOT NULL,
  identity_commitment TEXT NOT NULL,
  draw_title          TEXT NOT NULL,
  entry_ids           INTEGER[] NOT NULL,
  entry_count         INTEGER NOT NULL,
  tickets             INTEGER NOT NULL,
  receipt_code        TEXT NOT NULL UNIQUE,
  receipt_hash        TEXT NOT NULL,
  delivery_channel    TEXT NOT NULL,
  prev_hash           TEXT NOT NULL,
  record_hash         TEXT NOT NULL UNIQUE,
  UNIQUE (draw_id, draw_seq)
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON confirmation_ledger (user_id);

CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'confirmation_ledger is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_no_update_delete ON confirmation_ledger;
CREATE TRIGGER ledger_no_update_delete BEFORE UPDATE OR DELETE ON confirmation_ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- Seal of each draw's chain, written when the draw closes.
ALTER TABLE draws ADD COLUMN IF NOT EXISTS seal_hash TEXT;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS seal_count INTEGER;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS sealed_at TIMESTAMPTZ;

-- Public entropy committed at close (drand round chosen in the future at seal time).
ALTER TABLE draws ADD COLUMN IF NOT EXISTS entropy_source TEXT;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS entropy_round BIGINT;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS entropy_value TEXT;

-- External anchors (OpenTimestamps / RFC 3161 / webhook) for each draw's commitment and seal.
CREATE TABLE IF NOT EXISTS draw_anchors (
  id            SERIAL PRIMARY KEY,
  draw_id       INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('commitment', 'seal')),
  provider      TEXT NOT NULL,
  digest_input  TEXT NOT NULL,
  digest        TEXT NOT NULL,           -- sha256(digest_input), the 32 bytes submitted
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  proof_b64     TEXT,
  proof_format  TEXT,
  info          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  next_try_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draw_id, kind, provider)
);

-- Winner announcement settings
ALTER TABLE draws ADD COLUMN IF NOT EXISTS announcement_visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE draws ADD COLUMN IF NOT EXISTS winner_show_full_name BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE outbox_emails ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The operator audit log is append-only as well.
DROP TRIGGER IF EXISTS draw_logs_no_update ON draw_logs;
CREATE TRIGGER draw_logs_no_update BEFORE UPDATE ON draw_logs FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
ALTER TABLE draws ADD COLUMN IF NOT EXISTS run_requested BOOLEAN NOT NULL DEFAULT false;

-- Reminders & preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminders_opt_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminders_opt_out_method TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS short_notice_opt_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS keep_on_reseed BOOLEAN NOT NULL DEFAULT false; -- real accounts (npm run create-user) survive demo reseeds
ALTER TABLE draws ADD COLUMN IF NOT EXISTS reminder_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS short_notice_hours INTEGER;
CREATE TABLE IF NOT EXISTS reminder_log (
  id         SERIAL PRIMARY KEY,
  draw_id    INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL CHECK (type IN ('24h', 'short_notice')),
  outcome    TEXT NOT NULL CHECK (outcome IN ('sent', 'skipped_at_cap', 'skipped_draw_closed', 'skipped_opted_out', 'skipped_unsubscribed', 'failed')),
  channel    TEXT,
  email_id   INTEGER,
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draw_id, user_id, type)     -- idempotency: one decision per member/draw/type
);
CREATE TABLE IF NOT EXISTS preference_events (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  event      TEXT NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('dashboard', 'one_click_link', 'list_unsubscribe_post', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recurring schedules (draw calendar)
CREATE TABLE IF NOT EXISTS draw_schedules (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT NOT NULL,
  title_template          TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  mode                    TEXT NOT NULL CHECK (mode IN ('equal', 'weighted')),
  prize_cents             INTEGER NOT NULL,
  entry_price_cents       INTEGER NOT NULL,
  max_entries_per_user    INTEGER NOT NULL DEFAULT 5,
  announcement_visibility TEXT NOT NULL DEFAULT 'public',
  rule                    JSONB NOT NULL,          -- { freq: weekly|monthly|cron, byWeekday, byMonthDay, time "HH:MM", cron }
  timezone                TEXT NOT NULL DEFAULT 'UTC',
  window_minutes          INTEGER NOT NULL,        -- entry window length; opens = close - window
  reminder_hours          INTEGER NOT NULL DEFAULT 24,
  short_notice_hours      INTEGER,
  horizon_days            INTEGER NOT NULL DEFAULT 14,
  paused                  BOOLEAN NOT NULL DEFAULT false,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);
ALTER TABLE draws ADD COLUMN IF NOT EXISTS schedule_id INTEGER REFERENCES draw_schedules(id) ON DELETE SET NULL;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS occurrence_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS draws_schedule_occurrence_uidx ON draws (schedule_id, occurrence_at) WHERE schedule_id IS NOT NULL;
ALTER TABLE draws DROP CONSTRAINT IF EXISTS draws_status_check;
ALTER TABLE draws ADD CONSTRAINT draws_status_check CHECK (status IN ('scheduled', 'open', 'closed', 'drawn', 'void'));

-- Winner-announcement delivery & engagement log
CREATE TABLE IF NOT EXISTS announcement_events (
  id         SERIAL PRIMARY KEY,
  draw_id    INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id),
  event      TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'system',
  email_id   INTEGER,
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ann_events_draw_idx ON announcement_events (draw_id);
ALTER TABLE outbox_emails ADD COLUMN IF NOT EXISTS track_token TEXT;

-- Invite-only access requests from the public landing page. Additive; does not create accounts.
CREATE TABLE IF NOT EXISTS access_requests (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  email_id   INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_requests_created_idx ON access_requests (created_at DESC);
