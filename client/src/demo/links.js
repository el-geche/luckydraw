/**
 * Static-preview only: plain <a href="/api/..."> links (PDF reports, exports, proofs, cards) cannot reach a
 * server, so route them through the in-browser demo backend and hand the result to the browser as a file.
 */
import { getToken } from '../lib/api.js';

function filenameFrom(res, href, a) {
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return a.getAttribute('download') || (m && m[1]) || href.split('?')[0].split('/').pop();
}

export function installApiLinkInterceptor() {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !/^\/api\//.test(href)) return;
    e.preventDefault();
    const win = a.hasAttribute('download') ? null : window.open('', '_blank');
    try {
      const { demoFetch } = await import('./backend.js');
      const token = getToken();
      const res = await demoFetch(href, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Request failed (${res.status})`); }
      const url = URL.createObjectURL(await res.blob());
      const attach = a.hasAttribute('download') || /attachment/i.test(res.headers.get('content-disposition') || '');
      if (win && !attach) win.location.href = url;
      else {
        win?.close();
        const dl = Object.assign(document.createElement('a'), { href: url, download: filenameFrom(res, href, a) });
        document.body.appendChild(dl); dl.click(); dl.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      window.dispatchEvent(new CustomEvent('ld:demo-error', { detail: err.message }));
      alert(`Demo mode: ${err.message}`); // eslint-disable-line no-alert
    }
  }, true);
}
