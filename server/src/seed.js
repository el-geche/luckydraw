/**
 * Seed data: demo users, wallet history, four completed draws (run through the
 * real engine with real commit-reveal seeds), one closed draw awaiting an admin
 * trigger, and two open draws with live countdowns.
 */
import bcrypt from 'bcryptjs';
import seedrandom from 'seedrandom';
import { DEMO_ACCOUNTS, REFERRER_BONUS_CENTS, REFEREE_BONUS_CENTS, WELCOME_BONUS_CENTS } from './demoAccounts.js';
import { addTransaction } from './services/wallet.js';
import { createDraw, enterDraw, closeDraw, executeDraw } from './services/draws.js';
import { migrate } from './db/index.js';
import { sendEntryReceiptEmail } from './services/receipts.js';
import { newUnsubscribeToken, setPreferences } from './services/reminders.js';
import { afterDraw } from './services/lifecycle.js';
import { createSchedule, materializeSchedules } from './services/schedules.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export async function seedDatabase(db, { log = () => {}, mailTransport } = {}) {
  await migrate(db);
  // Real accounts created with `npm run create-user` survive reseeding (their demo activity does not).
  const { rows: kept } = await db.query('SELECT email, name, password_hash, role, referral_code, unsubscribe_token, timezone, created_at FROM users WHERE keep_on_reseed');
  await db.exec('TRUNCATE announcement_events, preference_events, reminder_log, draw_anchors, confirmation_ledger, outbox_emails, entry_receipts, draw_logs, wallet_transactions, entries, draws, draw_schedules, users RESTART IDENTITY CASCADE');
  const now = Date.now();
  const t0 = new Date(now - 45 * DAY);
  const rand = seedrandom('luckydraw-seed-data-v1'); // deterministic *choice* of seed data (not draw seeds)

  // Users
  const ids = {};
  for (const a of DEMO_ACCOUNTS) {
    const hash = await bcrypt.hash(a.password, 8);
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash, role, referral_code, referred_by, created_at, unsubscribe_token, timezone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [a.email, a.name, hash, a.role, a.referralCode, a.referredBy ? ids[a.referredBy] : null, t0, newUnsubscribeToken(), a.timezone ?? 'Africa/Nairobi']);
    ids[a.email] = rows[0].id;
  }
  for (const k of kept) {
    await db.query(
      `INSERT INTO users (email, name, password_hash, role, referral_code, created_at, unsubscribe_token, timezone, keep_on_reseed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
      [k.email, k.name, k.password_hash, k.role, k.referral_code, k.created_at, k.unsubscribe_token ?? newUnsubscribeToken(), k.timezone]);
  }
  const members = DEMO_ACCOUNTS.filter((a) => a.role === 'member');
  log(`  users: ${DEMO_ACCOUNTS.length}${kept.length ? ` (+${kept.length} kept real account${kept.length > 1 ? 's' : ''})` : ''}`);

  // Wallet history (all simulated)
  for (const [i, a] of members.entries()) {
    const uid = ids[a.email];
    const at = new Date(t0.getTime() + i * HOUR);
    await addTransaction(db, { userId: uid, type: 'welcome_bonus', amountCents: WELCOME_BONUS_CENTS, description: 'Demo welcome credit', now: at });
    await addTransaction(db, { userId: uid, type: 'deposit', amountCents: [10000, 15000, 20000, 7500][i % 4], description: 'Simulated deposit (demo card •••• 4242)', providerRef: `sim_seed_${i}a`, now: new Date(at.getTime() + DAY) });
    if (i % 2 === 0) await addTransaction(db, { userId: uid, type: 'deposit', amountCents: 5000, description: 'Simulated deposit (demo card •••• 4242)', providerRef: `sim_seed_${i}b`, now: new Date(at.getTime() + 20 * DAY) });
    if (a.referredBy) {
      await addTransaction(db, { userId: uid, type: 'referral_bonus', amountCents: REFEREE_BONUS_CENTS, description: `Referral welcome bonus (invited by ${DEMO_ACCOUNTS.find((x) => x.email === a.referredBy).name})`, now: at });
      await addTransaction(db, { userId: ids[a.referredBy], type: 'referral_bonus', amountCents: REFERRER_BONUS_CENTS, description: `Referral bonus — ${a.name} joined with your code`, now: at });
    }
  }

  const admin = { actor: 'admin:Morgan Hale', actorId: ids['admin@luckydraw.demo'] };
  const fillEntries = async (draw, at, pool, weighted) => {
    for (const a of pool) {
      const count = 1 + Math.floor(rand() * 5);          // 1..5 (the cap)
      for (let k = 0; k < count; k++) {
        const tickets = weighted ? 1 + Math.floor(rand() * 4) : 1;
        await enterDraw(db, { drawId: draw.id, userId: ids[a.email], count: 1, tickets, now: new Date(at.getTime() + k * 600000 + rand() * HOUR) });
      }
    }
  };

  // Completed draws
  const past = [
    { title: 'Founders’ Launch Draw', mode: 'equal', prizeCents: 25000, entryPriceCents: 200, openDaysAgo: 30, lenDays: 7, take: 7, description: 'The inaugural LuckyDraw community draw. One entry, one equal slice.' },
    { title: 'September Community Draw', mode: 'weighted', prizeCents: 50000, entryPriceCents: 100, openDaysAgo: 22, lenDays: 7, take: 8, description: 'Weighted draw: each entry’s chance is proportional to its ticket count.' },
    { title: 'Autumn Equinox Draw', mode: 'equal', prizeCents: 15000, entryPriceCents: 150, openDaysAgo: 12, lenDays: 5, take: 6, description: 'Equal-entry seasonal draw.' },
    { title: 'Midweek Weighted Draw', mode: 'weighted', prizeCents: 30000, entryPriceCents: 100, openDaysAgo: 5, lenDays: 3, take: 8, description: 'Short weighted draw for the midweek community.' },
  ];
  for (const p of past) {
    const opensAt = new Date(now - p.openDaysAgo * DAY);
    const closesAt = new Date(opensAt.getTime() + p.lenDays * DAY);
    const d = await createDraw(db, { ...p, opensAt, closesAt }, { ...admin, now: opensAt });
    const pool = [...members].sort(() => rand() - 0.5).slice(0, p.take);
    await fillEntries(d, new Date(opensAt.getTime() + HOUR), pool, p.mode === 'weighted');
    await closeDraw(db, d.id, { actor: 'scheduler', now: closesAt });
    const { audit } = await executeDraw(db, d.id, { actor: admin.actor, now: new Date(closesAt.getTime() + 15 * 60000) });
    await afterDraw(db, audit, { now: new Date(closesAt.getTime() + 16 * 60000) });
    log(`  completed draw #${d.id} "${p.title}" (${p.mode}) — winner ${audit.winnerName}`);
  }

  // Closed, awaiting admin trigger
  {
    const opensAt = new Date(now - 2 * DAY);
    const closesAt = new Date(now - 1 * HOUR);
    const d = await createDraw(db, { title: 'Charity Pledge Draw', mode: 'equal', prizeCents: 20000, entryPriceCents: 250, opensAt, closesAt, description: 'Closed and awaiting the official draw. An admin can run it from the Admin console.' }, { ...admin, now: opensAt });
    await fillEntries(d, new Date(opensAt.getTime() + HOUR), members.slice(0, 6), false);
    await closeDraw(db, d.id, { actor: 'scheduler', now: closesAt });
    log(`  closed draw #${d.id} awaiting trigger`);
  }

  // Open draws
  {
    const opensAt = new Date(now - 1 * DAY);
    const d = await createDraw(db, { title: 'Weekly Community Draw', mode: 'equal', prizeCents: 40000, entryPriceCents: 200, opensAt, closesAt: new Date(now + 3 * DAY + 4 * HOUR), description: 'This week’s headline draw. One entry = one slice. Up to 5 entries per person.' }, { ...admin, now: opensAt });
    await fillEntries(d, new Date(opensAt.getTime() + HOUR), members.filter((a) => a.email !== 'ava@luckydraw.demo').slice(0, 6), false);
    // Proof-of-entry emails for this draw go to the dev outbox so the Demo outbox is populated out of the box.
    log(`  open draw #${d.id} (equal, closes in ~3 days)`);
  }
  {
    const opensAt = new Date(now - 2 * HOUR);
    const d = await createDraw(db, { title: 'Express Weighted Draw', mode: 'weighted', prizeCents: 12000, entryPriceCents: 100, autoDraw: true, opensAt, closesAt: new Date(now + 20 * 60000), description: 'Fast weighted draw that closes and draws automatically. Buy more tickets per entry for a larger slice.' }, { ...admin, now: opensAt });
    await fillEntries(d, new Date(opensAt.getTime() + 10 * 60000), members.slice(2, 7), true);
    await db.query('UPDATE draws SET short_notice_hours = 3 WHERE id = $1', [d.id]);
    log(`  open draw #${d.id} (weighted, auto-draw, closes in 20 min, 3h short-notice reminder)`);
  }

  // Proof-of-entry emails for every receipt (the audit-trail records were written with the entries).
  const { rows: receipts } = await db.query('SELECT * FROM entry_receipts ORDER BY id');
  for (const r of receipts) await sendEntryReceiptEmail(db, r, { transport: mailTransport, now: new Date(r.created_at) });
  log(`  ${receipts.length} confirmation emails rendered to the demo outbox`);

  // Reminder preferences: everyone opted in by default; two examples of opt-outs.
  await setPreferences(db, ids['hugo@luckydraw.demo'], { shortNoticeOptOut: true, method: 'dashboard' });
  await setPreferences(db, ids['grace@luckydraw.demo'], { remindersOptOut: true, method: 'one_click_link' });

  // Sample recurring schedule: every Friday 20:00 Nairobi time, 3-day entry window.
  await createSchedule(db, {
    name: 'Friday Evening Draw', titleTemplate: 'Friday Evening Draw — {date}', description: 'Weekly scheduled draw. Created automatically by the draw calendar with the full fairness stack.',
    mode: 'equal', prizeCents: 25000, entryPriceCents: 200, maxEntriesPerUser: 5, announcementVisibility: 'public',
    rule: { freq: 'weekly', byWeekday: [5], time: '20:00' }, timezone: 'Africa/Nairobi', windowMinutes: 3 * 24 * 60, reminderHours: 24, shortNoticeHours: 3, horizonDays: 14,
  }, 'seed');
  const m = await materializeSchedules(db);
  log(`  schedule "Friday Evening Draw" — ${m.created} draw(s) materialised`);
}
