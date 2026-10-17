import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
process.env.NEW_ORIGIN = 'https://luckydraw.up.railway.app';
const { handle } = await import('./server.js');

test('301 to new origin preserving path and query; /sw.js is a non-redirected kill switch', async () => {
  const srv = http.createServer(handle).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const p of ['/', '/verify?x=1', '/api/health', '/draws/3/results?tab=odds&y=%20z', '/v/7']) {
      const r = await fetch(base + p, { redirect: 'manual' });
      assert.equal(r.status, 301, p);
      assert.equal(r.headers.get('location'), `https://luckydraw.up.railway.app${p}`);
    }
    const post = await fetch(`${base}/api/auth/login`, { method: 'POST', redirect: 'manual', body: '{}' });
    assert.equal(post.status, 301);
    const sw = await fetch(`${base}/sw.js`, { redirect: 'manual' });
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get('content-type'), /javascript/);
    assert.match(sw.headers.get('cache-control'), /no-store/);
    const body = await sw.text();
    assert.match(body, /unregister\(\)/);
    assert.match(body, /caches\.delete/);
  } finally { srv.close(); }
});
