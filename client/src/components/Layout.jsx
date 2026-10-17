import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../lib/auth.jsx';
import { money } from '../lib/format.js';
import { Logo } from './Logo.jsx';
import { StaticPreviewBanner } from './StaticPreview.jsx';
import { InstallLink, HeaderInstall } from './Pwa.jsx';

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <span className="demo-dot" aria-hidden /> <strong>DEMO PLATFORM</strong>
      <span className="sep">·</span> No real money. All balances, deposits and payouts are simulated.
    </div>
  );
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
  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label="LuckyDraw home"><Logo /><span>LuckyDraw</span></Link>
        <nav className="nav-desktop"><NavItems /></nav>
        <div className="header-right">
          <HeaderInstall />
          {user ? (
            <>
              <Link to="/dashboard" className="balance-pill" title="Simulated demo balance">
                <span className="tag-demo">DEMO</span>{money(balanceCents ?? 0)}
              </Link>
              <div className="user-chip" title={user.email}><span className="avatar">{user.name[0]}</span><span className="user-name">{user.name.split(' ')[0]}</span></div>
              <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
            </>
          ) : (
            <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`} className="btn btn-gold btn-sm">Sign in</Link>
          )}
          <button className="menu-btn" aria-label="Menu" onClick={() => setOpen((o) => !o)}><span /><span /><span /></button>
        </div>
      </div>
      <StaticPreviewBanner />
      <AnimatePresence>
        {open && (
          <motion.nav className="nav-mobile" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <NavItems onNavigate={() => setOpen(false)} />
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
        <div><Logo size={20} /> <strong>LuckyDraw</strong> <span className="muted">— provably fair draws. Demonstration software; no real money is accepted or paid.</span></div>
        <div className="footer-links"><InstallLink /><Link to="/history">Draw history</Link><Link to="/upcoming">Upcoming draws</Link><Link to="/verify">Verify a draw</Link><Link to="/verify-receipt">Verify a receipt</Link><Link to="/how-it-works">Algorithm</Link><Link to="/faq">FAQ</Link><Link to="/terms">Terms of Service</Link><Link to="/privacy">Privacy Policy</Link></div>
      </div>
    </footer>
  );
}
