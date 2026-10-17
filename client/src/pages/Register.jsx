import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Page, Rise } from '../components/Page.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card, ErrorNote } from '../components/ui.jsx';

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({ name: '', email: '', password: '', referralCode: params.get('ref') || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await register(f); nav('/dashboard'); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Page className="auth-page">
      <Rise><Card className="auth-card narrow">
        <h1>Create a demo account</h1>
        <p className="muted">You’ll receive $50.00 in simulated demo credit. A referral code adds a $10.00 demo bonus (and $5.00 to the referrer).</p>
        <form onSubmit={submit} className="stack">
          <label>Full name<input className="input" value={f.name} onChange={set('name')} required minLength={2} /></label>
          <label>Email<input className="input" type="email" value={f.email} onChange={set('email')} required /></label>
          <label>Password<input className="input" type="password" value={f.password} onChange={set('password')} required minLength={6} /></label>
          <label>Referral code <span className="muted">(optional — try AVA-7K2Q)</span><input className="input mono" value={f.referralCode} onChange={set('referralCode')} /></label>
          <ErrorNote error={err} />
          <Button type="submit" loading={busy} className="btn-gold btn-block">Create account</Button>
        </form>
        <p className="muted small">Already registered? <Link className="link" to="/login">Sign in</Link></p>
      </Card></Rise>
    </Page>
  );
}
