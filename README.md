# LuckyDraw

A professional, provably fair raffle platform. **Demo only: no real money is accepted or paid.** Balances,
deposits, payouts and referral bonuses are all simulated.

Stack: React 18 + Vite + Framer Motion (installable PWA) · Node.js/Express · Postgres (embedded PGlite by default,
real Postgres or Supabase via `DATABASE_URL`) · a shared draw engine (`seedrandom`) that runs identically on the server
and in the browser.

---

## Quick start

```bash
npm install          # installs all workspaces (shared, server, client)
npm run seed         # creates the embedded database with demo data
npm run dev          # API on http://localhost:4000, web app on http://localhost:5173
```

Production build (one process, with service worker and offline support):

```bash
npm run build        # builds client/dist (manifest, sw.js, precache)
npm start            # Express serves the API and client/dist on http://localhost:4000
```

| Port | What |
|---|---|
| 5173 | Vite dev server (proxies `/api` and `/share` to 4000) |
| 4000 | Express API; also serves the production client from `client/dist` when it exists |
| 4173 | `npm run preview -w client` (proxies to 4000) |

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin / organizer | `admin@luckydraw.demo` | `admin123` |
| Members | `ava@`, `ben@`, `chloe@`, `daniel@`, `ella@`, `finn@`, `grace@`, `hugo@luckydraw.demo` | `demo123` |

Seed data: 9 users, 4 completed draws (equal + weighted, with winners, demo payouts, winner notifications and fairness
reports), 1 closed + sealed draw awaiting its trigger, 2 open draws (one closes in ~20 min and auto-draws), a weekly
"Friday Evening Draw" schedule (Fridays 20:00 Africa/Nairobi, 3-day entry window), 116 confirmation emails in the demo
outbox, reminder decisions (including opt-out and unsubscribe examples) and pending external anchors.
`Admin → Reset demo data` reseeds a running server.

### Tests

```bash
npm test             # shared engine + crypto (16) and server API/fairness suites (23)
node scripts/pwa-check.mjs        # PWA checks against the production build on :4000 (needs Chrome)
node scripts/screenshots.mjs      # page screenshots → screenshots/
```

---

## Folder structure

```
shared/           draw engine and crypto used by BOTH server and browser
  src/drawEngine.js   luckydraw-v1 algorithm, verifyAudit()
  src/crypto.js       pure-JS SHA-256 / HMAC-SHA256 (byte-identical everywhere)
  src/seed.js         seed derivation v3 (crowd entropy, public random, final seed)
  src/ledger.js       per-draw hash chain: record hashing + verifyDrawChain()
  src/bundle.js       one-click verifyBundle() (8 ordered checks) + anchor proof check
server/
  src/app.js          core routes (auth, draws, entries, wallet, admin)
  src/routes/extra.js chain, anchors, bundle, reports, announcements, cards, receipts, upcoming,
                      unsubscribe, reminders, schedules, compliance
  src/services/       draws (lifecycle), ledger, receipts, entropy (drand), anchors (OTS/TSA/webhook),
                      report (fairness PDF), card (social PNG), winner, events, reminders, schedules,
                      compliance, exports, lifecycle (scheduler pass)
  src/db/             schema.sql + PGlite/Postgres adapter
  src/mail/           nodemailer layer: demo outbox (default) or SMTP
  test/               node:test suites (api, fairness)
client/
  src/pages/          Home, Upcoming, DrawDetail (wheel), Results, Winner, VerifyDraw, Verify (paste),
                      VerifyReceipt, History, FAQ, Dashboard, Outbox, Admin (+ AdminExtra tabs), Legal
  src/components/     DrawWheel, Fairness (seal/anchors), Pwa (install/update/offline), ui
  public/             icons (generated), offline.html
  scripts/generate-icons.mjs
scripts/              screenshots.mjs, pwa-check.mjs
screenshots/          PNG screenshots + sample PDFs + pwa-check.json
```

---

## Draw rules

* **Equal mode**: one entry is one slice of weight 1.
* **Weighted mode**: each entry carries 1–10 tickets and its weight is its ticket count. Odds = your weight ÷ total weight.
* **Cap**: at most 5 entries per person per draw (configurable 1–5 per draw). Enforced server-side inside a
  transaction that holds a row lock on the draw, so concurrent requests cannot exceed it. The engine also refuses a
  list that breaks the cap.
* **Algorithm `luckydraw-v1`**: entries are ordered by entry ID and laid out as consecutive ticket ranges;
  `u = seedrandom(finalSeed)()`, `ticket = floor(u × totalWeight)`, and the winner is the entry whose range holds `ticket`.
* **Lifecycle**: `scheduled → open (countdown) → closed + sealed → drawn` (or `void` if there were no entries).

## Fairness stack

1. **Commit (open)**: a 256-bit `serverSeed` comes from `crypto.randomBytes`. Only `commitment = SHA-256(serverSeed)`
   (SHA-256 of the 64-character hex string, UTF-8) is published, and it is anchored externally. The seed is never
   returned by any API, page, log, email, export, PDF or admin screen before the draw is closed, sealed and run.
   `fairness.test.js` crawls every public and admin endpoint, the PDFs, the outbox files and the draw logs to assert this.
2. **Audit chain (entries)**: every entry confirmation is appended to `confirmation_ledger` inside the entry
   transaction. Each record stores `prevHash` and `recordHash = SHA-256(canonical fields)`; the genesis is
   `SHA-256("luckydraw-ledger-v1|draw:<id>|<commitment>")`. The table is append-only (a database trigger rejects
   UPDATE/DELETE). Public copies are privacy-masked: masked name (`A*** M.`) and a salted identity commitment instead of
   email or full name.
3. **Seal (close)**: the final chain hash, record count and seal time are stored and published. Appends to a sealed draw
   are rejected. The seal is anchored externally.
4. **Seed derivation `luckydraw-seed-v3` (draw)**:
   * `crowdEntropy = SHA-256(utf8(sort(upper(receiptCodes)).join("\n")))`
   * `publicRandom = SHA-256(bytes(crowdEntropy) ‖ bytes(beaconValue))`. The beacon is the drand round chosen at
     seal time: the first round at least one period *after* the seal, so its value did not exist yet.
   * `finalSeed = HMAC-SHA256(key = bytes(serverSeed), msg = bytes(publicRandom) ‖ bytes(sealHash))`

   **Why both crowd entropy and a beacon?** Receipt codes alone can be ground: the last entrant or the operator could
   retry entries until the hash looked favourable. The drand value is outside anyone's control and is fixed only after
   close, and the HMAC is keyed by a seed committed before the first entry. Until drand publishes the round, the draw
   waits (admin "Run" returns 202 and the scheduler runs it automatically). If drand is unreachable for more than
   `ENTROPY_FALLBACK_MS` past the round, the draw proceeds without a beacon and records that fact publicly.
5. **Verify**: `/verify/:id` runs `verifyBundle()` in the browser: chain → seal → anchor → commitment → crowd entropy
   → public random → final seed → winner. Each step is animated and marked Match / Mismatch / Pending. The page lists
   the receipt codes, the full derivation, the public chain (downloadable) and the anchor proofs, and re-spins the
   wheel with the derived seed.

### External anchoring and trust model

Pluggable providers run on open (commitment) and close (seal). They never block a draw: failures stay `pending` and
retry with backoff.

* **OpenTimestamps** (default): the server POSTs `SHA-256(digestInput)` to public calendars and stores the `.ots`
  proof. A background job (or *Admin → Anchors → Upgrade*) later fetches the Bitcoin attestation. Only a hash leaves
  the server. Verify it independently with `ots verify proof.ots -d <digest>` or at opentimestamps.org.
* **RFC 3161 TSA** (optional, `ANCHOR_PROVIDERS=opentimestamps,rfc3161`, `TSA_URL`): stores the `.tsr` token.
  Verify with `openssl ts -verify -digest <digest> -in proof.tsr -CAfile cacert.pem -untrusted tsa.crt`.
* **Webhook** (optional, off by default, `ANCHOR_WEBHOOK_URL`): posts the digest to a URL you control. It uses no
  credentials unless you configure them. Nothing was posted to any public account during build or testing.

The browser check confirms that each proof file commits to the displayed digest and that the digest input names the
sealed hash. Checking the Bitcoin block itself requires a Bitcoin node or block header, which the `ots` client handles.
**Trust model:** with the anchors you do not have to trust the operator's clock or database for *when* the commitment
and seal existed, and with the chain and seal you do not have to trust it for *what* was entered. You still trust that
the operator did not withhold entries before sealing; entrants can detect that by checking their own receipt.

### Receipts and confirmation emails

Every entry produces a random 80-bit receipt code (`LD-XXXX-XXXX-XXXX-XXXX`, Crockford base32) and a confirmation
email with the entry IDs, draw ID, timestamp, receipt hash and a deep link to `/verify-receipt?code=…`.
`/verify-receipt` is public and needs no login. It is rate-limited per IP (`RECEIPT_RATE_MAX` per `RECEIPT_RATE_WINDOW_MS`,
IPs are not stored) and shows validity, timestamps (local and UTC), draw and status, entry count, a masked holder name and
whether the record checks out in the audit chain and against the seal. Members see their receipts under *Dashboard → Receipts*.

### Winners, fairness report, social card

* Once a draw is sealed and run, the winner gets a notification email (demo outbox, or SMTP if configured) with the
  one-page **Fairness Report PDF** attached. It is never generated before seal + draw (tested). Every send/resend is logged.
* `/draws/:id/winner` is the announcement page. Visibility is **public** (default), **unlisted** or **organizer-only**,
  set in *Admin → Winners*. The winner name is masked unless the winner opts in under *Dashboard → Past results*.
* `/api/draws/:id/card.png` is a 1200×630 social card, served only for public announcements. `/share/draws/:id` serves
  Open Graph / Twitter meta for crawlers.
* Fairness Report PDF: `/api/draws/:id/report.pdf`, linked from the results, verify, admin and announcement pages. The
  seed shows as "withheld until seal" until the draw has run.

### Reminders and opt-out

The scheduler records a decision for every eligible member and reminder (24-hour and optional short-notice):
`sent / skipped_at_cap / skipped_draw_closed / skipped_opted_out / skipped_unsubscribed / failed`. Decisions are
idempotent, with one per member, draw and type. Every email carries a one-click unsubscribe link and the RFC 8058
`List-Unsubscribe` headers. Unsubscribes and dashboard changes take effect immediately and are logged with time and method.
*Admin → Reminders* has filters, summary counts and CSV/JSON export.
**Privacy note on open tracking:** reminders never contain a tracking pixel. Winner emails carry one only when SMTP is
configured **and** `MAIL_OPEN_TRACKING=true`. Opens are approximate (clients block or prefetch pixels) and raw IPs are never stored.

### Draw calendar and upcoming draws

*Admin → Calendar* shows a month view (open, scheduled, projected and drawn) and recurring schedules (daily, weekly,
monthly or cron, in an organizer time zone, with entry window, prize, mode, cap, announcement visibility and reminders).
The scheduler creates occurrences within each schedule's horizon, each with its own secret seed. It publishes and anchors
the commitment when the window opens, then closes, seals, anchors, draws and notifies automatically. It is idempotent.
`/upcoming` is public and fed by `/api/upcoming`, which returns only whitelisted fields (a test checks this). It lists
open draws (with countdown and commitment), created scheduled draws and projected occurrences for the next 8 weeks,
with filters.

### Audit exports and admin trail

* Per draw: `/api/draws/:id/export.json` and `export.csv` include the seed derivation, receipt codes, privacy-masked
  confirmation trail, anchor proofs (base64), entry list and winner. JSON: `exportSha256 = sha256(JSON.stringify(content))`.
  CSV: the last line is the sha256 of all preceding bytes.
* *Admin → Audit trail*: filter by draw, member, date or receipt code. It also offers the rendered email, server-side
  **Verify chain**, and CSV/JSON export of the full or filtered history with chain hashes.
* *Admin → Compliance*: a one-page **Compliance Summary** PDF plus HTML preview for regulators and sponsors, with live stats.

---

## Progressive Web App

* **Manifest** (`vite-plugin-pwa`): name and short_name `LuckyDraw`, `start_url` and `scope` `/`, `display: standalone`,
  theme and background `#0b1324`, icons 64/128/192/256/512 plus maskable 192/512, `apple-touch-icon` 180. Icons are
  generated from an SVG gold-on-navy mark by `node client/scripts/generate-icons.mjs`.
* **Service worker** (Workbox, generateSW):
  * Precaches the app shell, JS, CSS, fonts and icons.
  * Every client route falls back to the cached shell, so deep links and home-screen launches work online and offline.
  * Runtime caches: fonts (CacheFirst) and images (StaleWhileRevalidate).
  * `GET /api/draws` list queries and `/api/upcoming` are NetworkFirst with a 4-second timeout and serve the last copy
    only when offline.
  * All other `/api` traffic goes to the network and is never cached. That covers auth, `/me`, admin, receipts, audit,
    seed, verification bundles, exports, anchors and PDFs, and no POST is ever cached.
  * Server-rendered `/share/*` pages fall back to `offline.html`.
* **Update flow:** `registerType: 'prompt'` shows a "New version available · Reload" toast. Express serves `sw.js`,
  `index.html` and the manifest with `no-cache` and hashed assets as immutable.
* **Install:**
  * `beforeinstallprompt` is captured in `index.html` before React mounts.
  * A dismissible banner, a header button and a footer link appear only when the browser offers installation and the
    app is not already running standalone (`display-mode: standalone` / `navigator.standalone`).
  * "Not now" is remembered in localStorage; the footer link still offers install.
  * iOS Safari users get a "Share › Add to Home Screen" hint instead.
* **Offline:** a serious-toned notice bar appears, and previously viewed public pages and lists remain readable. Entering
  a draw, signing in and verification need a connection.
* **Verification:** run `npm run build && npm start`, then `node scripts/pwa-check.mjs`. It checks the manifest and icons,
  SW registration and control, the core pages offline, that nothing sensitive is cached, the install UI (synthetic
  `beforeinstallprompt`, standalone and iOS cases) and the CDP `Page.getInstallabilityErrors` and `Page.getAppManifest`
  calls. The latest result is in `screenshots/pwa-check.json`.

## Static preview (GitHub Pages / Vercel)

The hosted previews are **frontend only**. GitHub Pages and the Vercel static deployment have no Express API and no
database, so the client is built in *static preview* mode:

```bash
VITE_BASE=/luckydraw/ VITE_STATIC_PREVIEW=1 npm run build -w client   # GitHub Pages (repo base path)
VITE_STATIC_PREVIEW=1 npm run build -w client                         # root-hosted static (Vercel)
```

* `VITE_BASE` sets the router basename, asset URLs, manifest `id`/`start_url`/`scope`/icons and the service-worker
  navigation fallback. `404.html` is a copy of `index.html`, so deep links work on Pages.
* In static preview, a persistent banner reads *"Static preview on GitHub Pages: live draws need the backend; see
  README to run it"*. API-backed views show a clear "needs the backend" message instead of broken data. A normal
  build shows the same banner automatically if `/api` turns out to be unreachable.
* These work fully client-side: **Verify** (paste seed + entries; it uses the same shared engine and SHA-256),
  **Algorithm / How it works**, **FAQ**, **Terms**, **Privacy**, the PWA install/offline shell.
* These need the backend: live and upcoming draws, entering, accounts and wallet, receipts lookup, history and results
  data, published-draw verification bundles, PDFs, the outbox and admin.
* Deployment: the built preview is published to the `gh-pages` branch (Pages source: branch). `deploy/github-pages-workflow.yml` is a ready-made GitHub Actions alternative that tests, builds and deploys with `actions/deploy-pages`. Copy it to `.github/workflows/` to use it.

To host the **full stack**, run the Express server (it serves `client/dist`) on a Node host such as Render, Railway,
Fly.io or a VM, with `DATABASE_URL` pointing at managed Postgres (Supabase, Neon, Render/Railway Postgres). PGlite
needs a persistent disk and a single instance. On Vercel, the API would have to become serverless functions with
external Postgres, and the in-process scheduler would move to Vercel Cron.

---

## Configuration (env)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | empty → PGlite at `server/.data/pglite` | Postgres/Supabase connection string (`PGSSL=true` for SSL) |
| `PORT` / `APP_URL` | 4000 / `http://localhost:5173` | API port; base URL used in emails |
| `JWT_SECRET` | dev value | **Set in any real deployment** |
| `MAIL_TRANSPORT` | `outbox` | `outbox` writes `.eml`/`.html` to `server/.data/outbox` and the DB; `smtp` uses `SMTP_HOST/PORT/SECURE/USER/PASS`, `MAIL_FROM` |
| `MAIL_OPEN_TRACKING` | `false` | Winner-email pixel (SMTP only) |
| `ENTROPY_PROVIDER` | `drand` | `none` disables the beacon (`DRAND_URL`, `ENTROPY_FALLBACK_MS`) |
| `ANCHOR_PROVIDERS` | `opentimestamps` | comma list: `opentimestamps,rfc3161,webhook` or `none`; `OTS_CALENDARS`, `TSA_URL`, `ANCHOR_WEBHOOK_URL` |
| `RECEIPT_RATE_MAX` / `RECEIPT_RATE_WINDOW_MS` | 20 / 60000 | receipt lookup rate limit |
| `ORGANIZER_TZ` | `Africa/Nairobi` | organizer local time in logs |

**Switching to Postgres or Supabase:** set `DATABASE_URL=postgres://…` (Supabase: use the pooled connection string
and `PGSSL=true`), then run `npm run seed`. The schema in `server/src/db/schema.sql` is applied automatically. The same
SQL runs on PGlite and Postgres, and the test suite can target Postgres with `TEST_DATABASE_URL`.

## Limitations

* Demo platform: there is no real payment processing and no KYC or age checks. The Compliance Summary and Fairness
  Reports describe technical mechanisms and are not legal advice or a certification. Organizers remain responsible for
  local lottery and raffle law and licensing.
* OpenTimestamps proofs stay "submitted · awaiting Bitcoin" for a few hours until the calendars aggregate. The in-browser
  check validates the proof's commitment, not the Bitcoin block header.
* The rate limiter is in-memory and per process. Use a shared store if you run several API instances.
* PGlite is single-process. The seed script talks to a running server through the admin API.
