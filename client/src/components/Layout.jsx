import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../lib/auth.jsx';
import { money } from '../lib/format.js';
import { Logo } from './Logo.jsx';
import { StaticPreviewBanner } from './StaticPreview.jsx';
import { InstallLink, HeaderInstall } from './Pwa.jsx';

export function DemoBanner() {
  return (<>
    <a href="#main" className="skip-link">Skip to content</a>
    <div className="demo-banner" role="note">
      <span className="demo-dot" aria-hidden /> <strong>DEMO PLATFORM</strong>
      <span className="sep">·</span> No real money. All balances, deposits and payouts are simulated.
    </div>
  </>);
}

function NavItems({ onNavigate }) {
  const { user } = useAuth();
  const items = [
    { to: '/', label: 'Draws', end: true },
    { to: '/upcoming', label: 'Upcoming' },
    { to: '/history', label: 'History' },
    { to: '/verify', label: 'Verify' },
    { to: '/verify-receipt', label: 'Receipts' },
    { to: '/faq', label: 'FAQ' },
    ...(user ? [{ to: '/dashboard', label: 'Dashboard' }, { to: '/outbox', label: 'Outbox' }] : []),
    ...(user?.role === 'admin' ? [{ to: '/admin', label: 'Admin' }] : []),
  ];
  return items.map((i) => (
    <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      {({ isActive }) => (<>{i.label}{isActive && <motion.span layoutId="nav-underline" className="nav-underline" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}</>)}
    </NavLink>
  ));
}

export function Header() {
  const { user, balanceCents, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const btnRef = useRef(null);
  const navRef = useRef(null);
  // Close the mobile menu on navigation, on Escape (returning focus to the toggle) and when resized to desktop.
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    const mq = window.matchMedia('(min-width: 961px)');
    const onMq = () => mq.matches && setOpen(false);
    document.addEventListener('keydown', onKey);
    mq.addEventListener?.('change', onMq);
    navRef.current?.querySelector('a')?.focus({ preventScroll: true });
    return () => { document.removeEventListener('keydown', onKey); mq.removeEventListener?.('change', onMq); };
  }, [open]);
  return (
    <header className={`header${open ? ' menu-open' : ''}`}>
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label="LuckyDraw home"><Logo /><span>LuckyDraw</span></Link>
        <nav className="nav-desktop" aria-label="Primary"><NavItems /></nav>
        <div className="header-right">
          <HeaderInstall />
          {user ? (
            <>
              <Link to="/dashboard" className="balance-pill" title="Simulated demo balance">
                <span className="tag-demo">DEMO</span>{money(balanceCents ?? 0)}
              </Link>
              <div className="user-chip" title={user.email}><span className="avatar">{user.name[0]}</span><span className="user-name">{user.name.split(' ')[0]}</span></div>
              <button className="btn btn-ghost btn-sm header-signout" onClick={logout}>Sign out</button>
            </>
          ) : (
            <Link to={`/login?next=${encodeURIComponent(loc.pathname === '/login' ? '/dashboard' : loc.pathname)}`} className="btn btn-gold btn-sm header-signin">Sign in</Link>
          )}
          <button ref={btnRef} type="button" className={`menu-btn${open ? ' is-open' : ''}`} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}><span /><span /><span /></button>
        </div>
      </div>
      <StaticPreviewBanner />
      <AnimatePresence>
        {open && (
          <motion.nav id="mobile-nav" ref={navRef} aria-label="Mobile" className="nav-mobile" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="container nav-mobile-inner">
              <NavItems onNavigate={() => setOpen(false)} />
              {user && (
                <div className="nav-mobile-account">
                  <span className="muted small">Signed in as <strong>{user.name}</strong></span>
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => { setOpen(false); logout(); }}>Sign out</button>
                </div>
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <div className="footer-logo"><Logo size={22} /> <strong>LuckyDraw</strong></div>
          <p className="muted small">Provably fair draws. Demonstration software — no real money is accepted or paid.</p>
        </div>
        <nav className="footer-cols" aria-label="Footer">
          <div className="footer-col"><h2 className="footer-h">Draws</h2><Link to="/upcoming">Upcoming draws</Link><Link to="/history">Draw history</Link><Link to="/faq">FAQ</Link></div>
          <div className="footer-col"><h2 className="footer-h">Verify</h2><Link to="/verify">Verify a draw</Link><Link to="/verify-receipt">Verify a receipt</Link><Link to="/how-it-works">Algorithm</Link></div>
          <div className="footer-col"><h2 className="footer-h">Legal</h2><Link to="/terms">Terms of Service</Link><Link to="/privacy">Privacy Policy</Link><InstallLink /></div>
        </nav>
      </div>
    </footer>
  );
}
