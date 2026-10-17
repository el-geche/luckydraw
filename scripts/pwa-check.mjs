/**
 * PWA verification against the PRODUCTION build served by Express (npm run build && npm start, port 4000).
 * Checks: 1) manifest + icons, 2) SW control + offline core pages, 3) install prompt UX, 4) installability (CDP).
 * Writes screenshots/pwa-*.png and prints a PASS/FAIL table. Exit code 1 if any check fails.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const OUT = path.resolve(process.env.OUT_DIR || 'screenshots');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (id, name, pass, detail) => { results.push({ id, name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// ---------- 1) manifest + icons ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  const res = await page.request.get(new URL(href, BASE).href);
  const m = await res.json();
  const ct = res.headers()['content-type'];
  check('1a', 'manifest linked + served as application/manifest+json', href && ct.includes('manifest+json'), `${href} (${ct})`);
  check('1b', 'name/short_name/start_url/scope/display', m.name === 'LuckyDraw' && m.short_name === 'LuckyDraw' && m.start_url === '/' && m.scope === '/' && m.display === 'standalone' && m.description, `display=${m.display}`);
  check('1c', 'theme/background navy', m.theme_color === '#0b1324' && m.background_color === '#0b1324', `${m.theme_color} / ${m.background_color}`);
  const want = [64, 128, 192, 256, 512];
  const dims = {};
  for (const ic of m.icons) {
    const r = await page.request.get(new URL(ic.src, BASE).href);
    const b = await r.body();
    dims[`${ic.src}`] = r.ok() && b.subarray(1, 4).toString() === 'PNG' ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : `HTTP ${r.status()}`;
  }
  const okAny = want.every((s) => m.icons.some((i) => i.sizes === `${s}x${s}` && i.purpose === 'any' && dims[i.src] === `${s}x${s}`));
  const okMask = m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512' && dims[i.src] === '512x512');
  check('1d', 'icons 64/128/192/256/512 + maskable 512 (real PNG sizes)', okAny && okMask, Object.entries(dims).map(([k, v]) => `${path.basename(k)}=${v}`).join(' '));
  const apple = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
  const ar = await page.request.get(new URL(apple, BASE).href); const ab = await ar.body();
  check('1e', 'apple-touch-icon 180', ab.readUInt32BE(16) === 180, apple);
  await ctx.close();
}

// ---------- 2) service worker + offline ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  const sw = await page.evaluate(() => ({ controller: navigator.serviceWorker.controller?.scriptURL, state: navigator.serviceWorker.controller?.state }));
  check('2a', 'service worker registered and controlling the page', sw.controller?.endsWith('/sw.js'), `${sw.controller} (${sw.state})`);
  const pages = [['/', 'h1'], ['/upcoming', 'text=Upcoming draws'], ['/history', 'text=Draw history'], ['/faq', 'h1'], ['/verify', 'h1'], ['/verify-receipt', 'text=Verify a receipt']];
  for (const [p] of pages) { await page.goto(BASE + p); await page.waitForLoadState('networkidle'); }
  // Sign in once to prove auth/admin responses are never put in the cache.
  await page.request.post(`${BASE}/api/auth/login`, { data: { email: 'admin@luckydraw.demo', password: 'admin123' } });
  await ctx.setOffline(true);
  const offlineOk = [];
  for (const [p, sel] of [...pages, ['/draws/6', '#root']]) {
    let ok = false; let err = '';
    try {
      await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForSelector(sel, { timeout: 6000 });
      ok = (await page.locator('header .brand').count()) > 0;
    } catch (e) { err = e.message.split('\n')[0]; }
    offlineOk.push(`${p}:${ok ? 'ok' : `FAIL ${err}`}`);
    if (p === '/upcoming') { await page.waitForSelector('.up-card', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(OUT, 'pwa-offline-upcoming.png') }); }
  }
  check('2b', 'core pages load with network offline (app shell + cached public data)', offlineOk.every((x) => x.endsWith(':ok')), offlineOk.join('  '));
  const bar = await page.locator('[data-testid="offline-bar"]').isVisible().catch(() => false);
  const cards = await page.goto(BASE + '/upcoming').then(() => page.waitForSelector('.up-card', { timeout: 6000 })).then(() => page.locator('.up-card').count()).catch(() => 0);
  check('2c', 'offline notice shown; cached public draws still listed', bar && cards > 0, `offline bar=${bar}, upcoming cards from cache=${cards}`);
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname + new URL(r.url).search);
    return out;
  });
  const bad = cached.filter((u) => /\/api\/(auth|me|admin|receipts)|\/audit|verification-bundle|chain\.json|export|report\.pdf|anchors/.test(u));
  check('2d', 'no auth/admin/receipt/seed/verification responses cached', bad.length === 0, `${cached.filter((u) => u.startsWith('/api')).join(', ')}`);
  const share = await page.goto(BASE + '/share/draws/1').then(() => page.textContent('h1')).catch((e) => e.message);
  check('2e', 'server-only page offline → serious offline fallback', /not connected/i.test(share || ''), share);
  await page.screenshot({ path: path.join(OUT, 'pwa-offline-fallback.png') });
  await ctx.close();
}

// ---------- 3) install prompt UX ----------
const fakePrompt = () => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  window.__promptCalls = 0;
  e.prompt = () => { window.__promptCalls++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  window.dispatchEvent(e);
};
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/upcoming'); await page.waitForTimeout(1500);
  const before = await page.locator('[data-testid="install-banner"], [data-testid="install-link"], [data-testid="header-install"]').count();
  check('3a', 'no install UI without beforeinstallprompt', before === 0, `elements=${before}`);
  await page.evaluate(fakePrompt);
  await page.waitForSelector('[data-testid="install-button"]', { timeout: 4000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'pwa-install-prompt.png') });
  const link = await page.locator('[data-testid="install-link"]').count();
  const header = await page.locator('[data-testid="header-install"]').isVisible();
  await page.click('[data-testid="install-button"]');
  await page.waitForTimeout(500);
  const calls = await page.evaluate(() => window.__promptCalls);
  const gone = await page.locator('[data-testid="install-banner"]').count();
  check('3b', 'banner + header button + footer link appear after event; Install calls prompt() once', link === 1 && header && calls === 1 && gone === 0, `header=${header}, footer link=${link}, prompt() calls=${calls}, banner after accept=${gone}`);
  // Dismiss is remembered across reloads (footer link still offers install).
  await page.reload(); await page.evaluate(fakePrompt);
  await page.click('[data-testid="install-dismiss"]');
  await page.reload(); await page.evaluate(fakePrompt); await page.waitForTimeout(1200);
  const afterDismiss = await page.locator('[data-testid="install-banner"]').count();
  const linkAfter = await page.locator('[data-testid="install-link"]').count();
  check('3c', 'dismissal remembered (banner hidden after reload, footer link remains)', afterDismiss === 0 && linkAfter === 1, `banner=${afterDismiss}, link=${linkAfter}`);
  await ctx.close();
}
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : orig(q));
  });
  const page = await ctx.newPage();
  await page.goto(BASE); await page.evaluate(fakePrompt); await page.waitForTimeout(1500);
  const n = await page.locator('[data-testid="install-banner"], [data-testid="install-link"], [data-testid="header-install"]').count();
  check('3d', 'hidden when already installed (display-mode: standalone)', n === 0, `elements=${n}`);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/upcoming'); await page.waitForTimeout(1600);
  const txt = await page.locator('[data-testid="install-banner"]').textContent().catch(() => '');
  await page.screenshot({ path: path.join(OUT, 'pwa-install-ios-hint.png') });
  check('3e', 'iOS Safari shows "Share > Add to Home Screen" hint (no prompt button)', /Add to Home Screen/.test(txt) && (await page.locator('[data-testid="install-button"]').count()) === 0, txt.trim().slice(0, 80));
  await ctx.close();
}
await browser.close();

// ---------- 4) installability via CDP ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-pwa-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROME, headless: true, args: ['--no-sandbox', '--headless=new'] });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  const man = await cdp.send('Page.getAppManifest');
  const parsed = man.data ? JSON.parse(man.data) : {};
  check('4a', 'CDP Page.getInstallabilityErrors returns no errors', installabilityErrors.length === 0, installabilityErrors.map((e) => e.errorId).join(', ') || 'none');
  check('4b', 'CDP Page.getAppManifest: parsed without errors, display standalone', (man.errors ?? []).length === 0 && parsed.display === 'standalone', `url=${man.url} display=${parsed.display} errors=${(man.errors ?? []).length}`);
  await ctx.close();
}
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(OUT, 'pwa-check.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
