"""Headless check of a static (in-browser demo backend) deployment.
Usage: python scripts/static-demo-check.py <base-url> <screenshot.png>
Steps: wait for demo backend, quick-login as Ava -> dashboard, enter an open draw, sign out,
wrong-password inline error, admin via the form -> admin page, outbox."""
import re, sys, time
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/') + '/'
shot = sys.argv[2] if len(sys.argv) > 2 else 'static-demo.png'
results = []
def ok(name, cond=True, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {extra}' if extra else ''), flush=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 900})
    pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    t0 = time.time()
    pg.goto(base + 'login', wait_until='domcontentloaded')
    expect(pg.get_by_test_id('static-banner')).to_contain_text('Demo mode: runs entirely in your browser; data is stored only on this device', timeout=20000)
    ok('banner text')
    expect(pg.get_by_test_id('quick-login-ava')).to_be_visible(timeout=10000)
    ok('demo account cards visible', pg.locator('[data-testid^=quick-login-]').count() >= 9, f"{pg.locator('[data-testid^=quick-login-]').count()} cards")
    pg.get_by_test_id('quick-login-ava').click()
    pg.wait_for_url(re.compile(r'/dashboard'), timeout=120000)
    expect(pg.locator('.balance-pill')).to_be_visible(timeout=30000)
    ok('quick login as Ava -> dashboard', True, f'{time.time()-t0:.1f}s incl. first-visit seeding; balance {pg.inner_text(".balance-pill")}')
    pg.wait_for_timeout(800)
    pg.screenshot(path=shot)
    # enter a draw
    pg.goto(base, wait_until='domcontentloaded')
    card = pg.locator('a[href*="/draws/"]').filter(has_text=re.compile('Open|Closes', re.I)).first
    card.wait_for(timeout=20000)
    href = card.get_attribute('href'); pg.goto(base + href.split('/luckydraw/')[-1].lstrip('/') if '/luckydraw/' in href else base + href.lstrip('/'))
    btn = pg.get_by_role('button', name=re.compile(r'Confirm \d+ entr'))
    btn.wait_for(timeout=20000)
    before = pg.locator('.balance-pill').inner_text()
    btn.click()
    pg.wait_for_selector('text=/Receipt|LD-[0-9A-Z]{4}-/', timeout=30000)
    pg.wait_for_timeout(1000)
    ok('enter a draw', True, f'{pg.url.split("/")[-1]} · balance {before} -> {pg.locator(".balance-pill").inner_text()}')
    pg.get_by_role('button', name='Sign out').click()
    ok('sign out', pg.get_by_role('link', name='Sign in').first.is_visible())
    # wrong password -> inline error
    pg.goto(base + 'login'); pg.fill('input[name=email]', 'admin@luckydraw.demo'); pg.fill('input[name=password]', 'wrong-pass')
    pg.get_by_role('button', name='Sign in', exact=True).click()
    expect(pg.get_by_test_id('login-error')).to_contain_text('Wrong email or password', timeout=15000)
    ok('wrong password shows inline error')
    # admin via form
    pg.fill('input[name=password]', 'admin123')
    pg.get_by_role('button', name='Show password').click()
    ok('show/hide password', pg.get_attribute('input[name=password]', 'type') == 'text')
    pg.get_by_role('button', name='Sign in', exact=True).click()
    pg.wait_for_url(re.compile(r'/admin'), timeout=30000)
    expect(pg.locator('h1')).to_be_visible(timeout=15000)
    pg.wait_for_timeout(1200)
    ok('admin via form -> admin page', True, pg.inner_text('h1'))
    pg.goto(base + 'admin?tab=mail')
    pg.wait_for_selector('text=/LD-[0-9A-Z]{4}-/', timeout=20000)
    ok('admin outbox lists emails')
    pg.goto(base + 'verify/1')
    pg.get_by_role('button', name='Verify this draw').click()
    pg.wait_for_selector('.verdict, [class*=verdict]', timeout=30000); pg.wait_for_timeout(4000)
    ok('one-click verify (draw #1)', True, pg.locator('[class*=verdict]').first.inner_text()[:80].replace('\n', ' '))
    print('page errors:', errs[:5])
    b.close()
fails = [r for r in results if not r[1]]
print(f'{len(results)-len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
