import { useEffect, useState } from 'react';
import { isBackendUnavailable, onBackendStatus, STATIC_PREVIEW } from '../lib/staticMode.js';
import { setToken } from '../lib/api.js';

const README = 'https://github.com/el-geche/luckydraw#quick-start';

/** Static builds: in-browser demo backend notice (+ reset). Full-stack builds: shown only if /api is unreachable. */
export function StaticPreviewBanner() {
  return STATIC_PREVIEW ? <DemoModeBanner /> : <UnreachableBanner />;
}

function DemoModeBanner() {
  const [st, setSt] = useState({ state: 'starting' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off;
    import('../demo/backend.js').then((m) => { setSt(m.getDemoStatus()); off = m.onDemoStatus(setSt); });
    return () => off?.();
  }, []);
  const reset = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Reset demo data on this device? All demo accounts, entries and draws return to the seeded state and you will be signed out.')) return;
    setBusy(true);
    try { const m = await import('../demo/backend.js'); await m.resetDemoData(); setToken(null); window.location.reload(); } finally { setBusy(false); }
  };
  const preparing = st.state === 'starting' || st.state === 'seeding';
  return (
    <div className="static-banner" role="status" data-testid="static-banner">
      <div className="container static-banner-inner">
        <span className="static-badge">Demo mode</span>
        <span className="static-text">
          Demo mode: runs entirely in your browser; data is stored only on this device.
          {' '}<span className="muted">The real server code and Postgres (PGlite) run in this tab; no email is sent and no money moves. To run the full stack, see the <a href={README} target="_blank" rel="noreferrer">README</a>.</span>
          {preparing && <span className="static-progress" data-testid="demo-preparing"> · {st.message || 'Starting…'}</span>}
          {st.state === 'error' && <span className="static-error"> · Demo backend failed to start: {st.message}</span>}
        </span>
        <button type="button" className="link-btn static-reset" onClick={reset} disabled={busy || preparing} data-testid="demo-reset">{busy ? 'Resetting…' : 'Reset demo data'}</button>
      </div>
    </div>
  );
}

function UnreachableBanner() {
  const [down, setDown] = useState(isBackendUnavailable());
  useEffect(() => onBackendStatus(setDown), []);
  if (!down) return null;
  return (
    <div className="static-banner" role="status" data-testid="static-banner">
      <div className="container static-banner-inner">
        <span className="static-badge">Backend unavailable</span>
        <span>The LuckyDraw server is not reachable, so live draws, accounts and receipts are unavailable; see the <a href={README} target="_blank" rel="noreferrer">README</a> to run it.</span>
      </div>
    </div>
  );
}
