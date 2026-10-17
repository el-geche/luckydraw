import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isBackendUnavailable, onBackendStatus, STATIC_PREVIEW } from '../lib/staticMode.js';

const HOST = import.meta.env.VITE_STATIC_HOST || 'GitHub Pages';
const README = 'https://github.com/el-geche/luckydraw#quick-start';

/** Serious, persistent notice shown when the API/database is not available (e.g. GitHub Pages). */
export function StaticPreviewBanner() {
  const [down, setDown] = useState(isBackendUnavailable());
  useEffect(() => onBackendStatus(setDown), []);
  if (!down) return null;
  return (
    <div className="static-banner" role="status" data-testid="static-banner">
      <div className="container static-banner-inner">
        <span className="static-badge">{STATIC_PREVIEW ? 'Static preview' : 'Backend unavailable'}</span>
        <span>
          {STATIC_PREVIEW ? `Static preview on ${HOST}: live draws need the backend; ` : 'The LuckyDraw server is not reachable, so live draws, accounts and receipts are unavailable; '}
          see the <a href={README} target="_blank" rel="noreferrer">README</a> to run it.
          {' '}Working here: <Link to="/verify">Verify (paste seed + entries)</Link>, <Link to="/how-it-works">Algorithm</Link>, <Link to="/faq">FAQ</Link>, <Link to="/terms">Terms</Link>, <Link to="/privacy">Privacy</Link>.
        </span>
      </div>
    </div>
  );
}
