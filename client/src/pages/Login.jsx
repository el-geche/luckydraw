import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card } from '../components/ui.jsx';
import { STATIC_PREVIEW } from '../lib/staticMode.js';
import { useRegistrationOpen } from '../lib/registration.js';
import { DEMO_ACCOUNTS } from '../../../server/src/demoAccounts.js';

// Seeded accounts are public demo credentials (documented in the README); shown even if the API is down.
const FALLBACK_ACCOUNTS = DEMO_ACCOUNTS.map(({ email, password, name, role }) => ({ email, password, name, role }));

/** Human-readable sign-in error (wrong password, server unreachable, demo engine failed…). */
export function signInMessage(err) {
  if (!err) return null;
  if (err.status === 401) return 'Wrong email or password. Demo members use demo123; the admin uses admin123.';
  if (err.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (err.status === 0 || err.body?.code === 'UNREACHABLE') return STATIC_PREVIEW
    ? `The in-browser demo backend could not start (${err.message}). Try reloading the page.`
    : 'Cannot reach the LuckyDraw server. Check that it is running (npm run dev) and try again.';
  return err.message || 'Sign-in failed. Please try again.';
}

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const { data } = useApi('/auth/demo-accounts');
  const { open: registrationOpen } = useRegistrationOpen();
  const accounts = data?.length ? data : FALLBACK_ACCOUNTS;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const pwRef = useRef(null);
  const go = async (e, p, key = 'form') => {
    setBusy(key); setErr(null);
    try {
      const u = await login(e, p);
      nav(u.role === 'admin' && next === '/dashboard' ? '/admin' : next);
    } catch (x) { setErr(x); } finally { setBusy(null); }
  };
  const fill = (a) => { setEmail(a.email); setPassword(a.password); setErr(null); pwRef.current?.focus(); };
  const msg = signInMessage(err);
  return (
    <Page className="auth-page">
      <div className="auth-grid">
        <Rise><Card className="auth-card">
          <h1>Sign in</h1>
          <p className="muted">Demo platform — accounts and money are simulated.</p>
          <form onSubmit={(e) => { e.preventDefault(); go(email, password); }} className="stack" noValidate>
            <label>Email<input className="input" type="email" name="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} required aria-invalid={err?.status === 401 || undefined} /></label>
            <label>Password
              <span className="pw-wrap">
                <input ref={pwRef} className="input" type={show ? 'text' : 'password'} name="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErr(null); }} required aria-invalid={err?.status === 401 || undefined} />
                <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {msg && <div className="note note-danger" role="alert" data-testid="login-error">{msg}</div>}
            <Button type="submit" loading={busy === 'form'} disabled={busy != null || !email || !password} className="btn-gold btn-block">{busy === 'form' ? 'Signing in…' : 'Sign in'}</Button>
          </form>
          {registrationOpen && <p className="muted small">New here? <Link className="link" to="/register">Create a demo account</Link></p>}
        </Card></Rise>
        <Rise><Card className="picker">
          <h3 className="card-title">Quick demo login</h3>
          <p className="muted small">One click signs you in as a seeded account, or use <strong>Fill</strong> to copy its credentials into the form. Members use password <span className="mono">demo123</span>; the admin uses <span className="mono">admin123</span>.</p>
          <div className="picker-grid" data-testid="demo-accounts">
            {accounts.map((a, i) => (
              <motion.div key={a.email} className={`picker-item${a.role === 'admin' ? ' admin' : ''}`}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <button type="button" className="picker-main" onClick={() => go(a.email, a.password, a.email)} disabled={busy != null} aria-label={`Sign in as ${a.name}`} data-testid={`quick-login-${a.email.split('@')[0]}`}>
                  <span className="avatar">{a.name[0]}</span>
                  <span className="picker-text"><strong>{a.name}</strong><span className="muted small">{a.email}</span></span>
                  <span className={`chip ${a.role === 'admin' ? 'chip-gold' : ''}`}>{busy === a.email ? <span className="spinner" aria-label="Signing in" /> : a.role}</span>
                </button>
                <button type="button" className="picker-fill" onClick={() => fill(a)} disabled={busy != null} title={`Fill ${a.email} / ${a.password}`}>Fill</button>
              </motion.div>
            ))}
          </div>
        </Card></Rise>
      </div>
    </Page>
  );
}
