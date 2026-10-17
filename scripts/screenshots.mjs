/**
 * Headless screenshots of the main pages. Requires the dev servers to be running
 * (npm run dev) and a Chromium/Chrome binary (CHROME_PATH, default /usr/bin/google-chrome).
 * NOTE: this triggers the seeded "Charity Pledge Draw" (#5) to capture the wheel spinning;
 * run `npm run seed` afterwards to restore the seed state.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = path.resolve(process.env.OUT_DIR || 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });

async function session(email, password, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  if (email) {
    const token = await page.evaluate(async ([e, p]) => (await (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).json()).token, [email, password]);
    await page.evaluate((t) => localStorage.setItem('luckydraw.token', t), token);
  }
  return page;
}
const shot = async (page, name, { full = true, wait = 1400 } = {}) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log('saved', name);
};
const go = async (page, url, name, opts) => { await page.goto(BASE + url, { waitUntil: 'networkidle' }); await shot(page, name, opts); };

const draws = await (await fetch(`${BASE}/api/draws`)).json();
const openEqual = draws.find((d) => d.status === 'open' && d.mode === 'equal');
const closed = draws.find((d) => d.status === 'closed');
const weightedDone = draws.find((d) => d.status === 'drawn' && d.mode === 'weighted');

const anon = await session();
await go(anon, '/', 'home');
await go(anon, '/history', 'history');
await go(anon, '/faq', 'faq');
await go(anon, '/terms', 'terms');
await go(anon, '/privacy', 'privacy');
await go(anon, `/draws/${weightedDone.id}/results`, 'results');
await go(anon, `/verify/${weightedDone.id}`, 'verify', { wait: 5500 });

const ava = await session('ava@luckydraw.demo', 'demo123');
await go(ava, `/draws/${openEqual.id}`, 'draw-open');
// Make an entry through the UI to produce a receipt + email.
await ava.click('.entry-panel .seg-btn:nth-child(2)');
await ava.click('.entry-panel button.btn-gold.btn-block');
await shot(ava, 'draw-entry-receipt', { wait: 1800 });
await go(ava, '/dashboard', 'dashboard');
await go(ava, '/outbox', 'outbox', { wait: 2000, full: false });
const code = await ava.locator('.mail-item .mono').first().textContent();
await go(ava, `/receipt/${code}`, 'receipt');

const admin = await session('admin@luckydraw.demo', 'admin123');
await go(admin, '/admin', 'admin');
await admin.getByRole('tab', { name: 'Outbox' }).click();
await shot(admin, 'admin-outbox');
await admin.getByRole('tab', { name: 'Logs & seeds' }).click();
await shot(admin, 'admin-logs');
await admin.getByRole('tab', { name: 'Draws', exact: true }).click();
await admin.waitForTimeout(800);
if (closed) {
  // Trigger the official draw from the admin console and capture the wheel mid-spin and landed.
  const row = admin.locator('tr', { hasText: closed.title });
  await row.locator('button', { hasText: 'Run draw' }).click();
  await admin.waitForURL(/watch=1/);
  await shot(admin, 'draw-wheel-spinning', { full: false, wait: 2600 });
  await shot(admin, 'draw-wheel-landed', { full: false, wait: 6500 });
  await shot(admin, 'draw-wheel-result', { full: true, wait: 800 });
}

const mobile = await session('ava@luckydraw.demo', 'demo123', { width: 390, height: 844 });
await go(mobile, '/', 'mobile-home');
await go(mobile, `/draws/${weightedDone.id}/results`, 'mobile-results');
await browser.close();
