import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card, ErrorNote } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const { data: accounts } = useApi('/auth/demo-accounts');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const go = async (e, p, key = 'form') => {
    setBusy(key); setErr(null);
    try {
      const u = await login(e, p);
      nav(u.role === 'admin' && next === '/dashboard' ? '/admin' : next);
    } catch (x) { setErr(x); } finally { setBusy(null); }
  };
  return (
    <Page className="auth-page">
      <div className="auth-grid">
        <Rise><Card className="auth-card">
          <h1>Sign in</h1>
          <p className="muted">Demo platform — accounts and money are simulated.</p>
          <form onSubmit={(e) => { e.preventDefault(); go(email, password); }} className="stack">
            <label>Email<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <ErrorNote error={err} />
            <Button type="submit" loading={busy === 'form'} className="btn-gold btn-block">Sign in</Button>
          </form>
          <p className="muted small">New here? <Link className="link" to="/register">Create a demo account</Link></p>
        </Card></Rise>
        <Rise><Card className="picker">
          <h3 className="card-title">Quick demo login</h3>
          <p className="muted small">One click signs you in as a seeded account. Members use password <span className="mono">demo123</span>; the admin uses <span className="mono">admin123</span>.</p>
          <div className="picker-grid">
            {accounts?.map((a, i) => (
              <motion.button key={a.email} className={`picker-item${a.role === 'admin' ? ' admin' : ''}`} onClick={() => go(a.email, a.password, a.email)}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} disabled={busy != null}>
                <span className="avatar">{a.name[0]}</span>
                <span className="picker-text"><strong>{a.name}</strong><span className="muted small">{a.email}</span></span>
                <span className={`chip ${a.role === 'admin' ? 'chip-gold' : ''}`}>{busy === a.email ? '…' : a.role}</span>
              </motion.button>
            ))}
          </div>
        </Card></Rise>
      </div>
    </Page>
  );
}
