import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const DISMISS_KEY = 'luckydraw.install.dismissed';

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || window.navigator.standalone === true;
const isIosSafari = () => {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
};

/** Tracks the captured beforeinstallprompt event (captured in index.html before React mounts). */
export function useInstall() {
  const [evt, setEvt] = useState(() => window.__ldInstall ?? null);
  const [installed, setInstalled] = useState(isStandalone);
  useEffect(() => {
    const on = () => setEvt(window.__ldInstall);
    const done = () => { setEvt(null); setInstalled(true); };
    window.addEventListener('ld:installable', on);
    window.addEventListener('ld:installed', done);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const mqOn = (e) => setInstalled(e.matches || isStandalone());
    mq?.addEventListener?.('change', mqOn);
    return () => { window.removeEventListener('ld:installable', on); window.removeEventListener('ld:installed', done); mq?.removeEventListener?.('change', mqOn); };
  }, []);
  const install = useCallback(async () => {
    const e = window.__ldInstall;
    if (!e) return null;
    window.__ldInstall = null; setEvt(null); // a prompt event can be used only once
    await e.prompt();
    const choice = await e.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') setInstalled(true);
    return choice?.outcome ?? null;
  }, []);
  return { canInstall: Boolean(evt) && !installed, installed, install, ios: !installed && isIosSafari() };
}

/** Footer link: always available when the browser offers installation (even if the banner was dismissed). */
export function InstallLink() {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return <button type="button" className="link-btn" data-testid="install-link" onClick={install}>Install app</button>;
}

/** Header button: shown only when the browser has offered installation and the app is not installed. */
export function HeaderInstall() {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return <button type="button" className="btn btn-ghost btn-sm header-install" data-testid="header-install" onClick={install} title="Install LuckyDraw as an app">⤓ Install app</button>;
}

function InstallBanner() {
  const { canInstall, install, ios } = useInstall();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY));
  const dismiss = () => { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); setDismissed('1'); };
  const show = !dismissed && (canInstall || ios);
  return (
    <AnimatePresence>
      {show && (
        <motion.aside className="install-banner" role="dialog" aria-label="Install LuckyDraw" data-testid="install-banner"
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.6, type: 'spring', stiffness: 260, damping: 26 } }} exit={{ opacity: 0, y: 24 }}>
          <img src={`${import.meta.env.BASE_URL}icons/icon-64.png`} width="40" height="40" alt="" />
          <div className="install-text">
            <strong>Install LuckyDraw</strong>
            {canInstall
              ? <span>Open draws, receipts and verification from your home screen. Works offline for pages you have viewed.</span>
              : <span>On iPhone or iPad: tap <b>Share</b> <span aria-hidden>⎋</span> then <b>Add to Home Screen</b>.</span>}
          </div>
          <div className="install-actions">
            {canInstall && <button type="button" className="btn btn-gold btn-sm" data-testid="install-button" onClick={async () => { const r = await install(); if (r === 'dismissed') dismiss(); }}>Install</button>}
            <button type="button" className="btn btn-ghost btn-sm" data-testid="install-dismiss" onClick={dismiss}>Not now</button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function UpdateToast() {
  const [state, setState] = useState({ need: false, offlineReady: false, update: null });
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let alive = true;
    import('virtual:pwa-register').then(({ registerSW }) => {
      const update = registerSW({
        immediate: true,
        onNeedRefresh: () => alive && setState((s) => ({ ...s, need: true })),
        onOfflineReady: () => { if (!alive) return; setState((s) => ({ ...s, offlineReady: true })); setTimeout(() => alive && setState((s) => ({ ...s, offlineReady: false })), 4500); },
        onRegisteredSW: (_url, reg) => { if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000); },
      });
      setState((s) => ({ ...s, update }));
    });
    return () => { alive = false; };
  }, []);
  return (
    <AnimatePresence>
      {(state.need || state.offlineReady) && (
        <motion.div className="pwa-toast" role="status" data-testid={state.need ? 'update-toast' : 'offline-ready-toast'} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
          {state.need ? (<><span>New version available.</span><button className="btn btn-gold btn-xs" onClick={() => state.update?.(true)}>Reload</button><button className="btn btn-ghost btn-xs" onClick={() => setState((s) => ({ ...s, need: false }))}>Later</button></>)
            : <span>LuckyDraw is ready to work offline for pages you have viewed.</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function OfflineBar() {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false); const off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return (
    <AnimatePresence>{offline && (
      <motion.div className="offline-bar" role="status" data-testid="offline-bar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
        You are offline. Showing the last public data saved on this device; entering draws, sign-in and verification need a connection.
      </motion.div>
    )}</AnimatePresence>
  );
}

export function PwaPrompts() {
  return <><OfflineBar /><InstallBanner /><UpdateToast /></>;
}
