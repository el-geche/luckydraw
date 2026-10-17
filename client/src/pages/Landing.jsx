import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { Button } from '../components/ui.jsx';
import { api } from '../lib/api.js';

export const LANDING_COPY = {
  eyebrow: 'Private platform · By invitation only',
  headline: 'Welcome to LuckyDraw.',
  body: 'LuckyDraw runs provably fair draws for a private community of members. Access is by invitation only, and public sign-up is closed. If you would like to take part, request access below and the organiser will review your request personally.',
  publicNote: 'You do not need an account to check our work. Every draw’s audit trail, receipts and results are public.',
};

const TRUST_LINKS = [
  { to: '/verify', title: 'Verify a draw', text: 'Recompute any completed draw in your browser.' },
  { to: '/verify-receipt', title: 'Look up a receipt', text: 'Confirm an entry was recorded in the sealed chain.' },
  { to: '/upcoming', title: 'Upcoming draws', text: 'See the published schedule and closing times.' },
  { to: '/history', title: 'Draw history', text: 'Every past result, with its fairness record.' },
  { to: '/faq', title: 'FAQ', text: 'How commit–reveal, sealing and anchoring work.' },
];

export default function Landing() {
  const [f, setF] = useState({ name: '', email: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== '#request-access') return undefined;
    const t = setTimeout(() => document.getElementById('request-access')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 450);
    return () => clearTimeout(t);
  }, [hash]);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr(null); };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setDone(await api('/access-requests', { method: 'POST', body: f })); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Page className="landing">
      <section className="landing-hero">
        <Rise className="landing-copy">
          <div className="eyebrow">{LANDING_COPY.eyebrow}</div>
          <h1>{LANDING_COPY.headline}</h1>
          <p className="lead">{LANDING_COPY.body}</p>
          <div className="hero-actions">
            <Link to="/login" className="btn btn-gold btn-lg">Sign in</Link>
            <a href="#request-access" className="btn btn-ghost btn-lg">Request access</a>
          </div>
          <ul className="landing-points">
            <li><span className="lp-dot" aria-hidden />Members are invited by the organiser — there is no self-service sign-up.</li>
            <li><span className="lp-dot" aria-hidden />Every draw is committed before entries open and sealed at close.</li>
            <li><span className="lp-dot" aria-hidden />Demonstration platform: balances and prizes are simulated.</li>
          </ul>
        </Rise>
        <Rise className="landing-form-col">
          <div className="card request-card" id="request-access">
            <AnimatePresence mode="wait" initial={false}>
              {done ? (
                <motion.div key="done" className="request-done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" aria-live="polite" data-testid="access-request-success">
                  <div className="done-icon" aria-hidden>✓</div>
                  <h2>Request received</h2>
                  <p>{done.message}</p>
                  <p className="muted small">Reference #{done.id}. Already invited? <Link className="link" to="/login">Sign in</Link></p>
                </motion.div>
              ) : (
                <motion.form key="form" onSubmit={submit} className="stack" noValidate initial={{ opacity: 1 }} exit={{ opacity: 0, y: -6 }} aria-labelledby="request-title">
                  <div>
                    <h2 id="request-title">Request access</h2>
                    <p className="muted small">Tell the organiser who you are. Submitting this form does not create an account.</p>
                  </div>
                  <label>Full name<input className="input" name="name" autoComplete="name" value={f.name} onChange={set('name')} required minLength={2} maxLength={80} /></label>
                  <label>Email address<input className="input" type="email" name="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} required maxLength={254} /></label>
                  <label><span>Message <span className="muted optional">(optional)</span></span>
                    <textarea className="input textarea" name="message" rows={3} maxLength={500} value={f.message} onChange={set('message')} placeholder="How do you know the organiser?" />
                    <span className="field-hint">{f.message.length}/500</span>
                  </label>
                  <div className="hp" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" name="website" value={f.website} onChange={set('website')} /></label></div>
                  {err && <div className="note note-danger" role="alert">{err.message}</div>}
                  <Button type="submit" loading={busy} disabled={busy || f.name.trim().length < 2 || !f.email.trim()} className="btn-gold btn-block btn-lg">Request access</Button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </Rise>
      </section>

      <section className="section landing-trust" aria-labelledby="trust-title">
        <div className="section-head"><h2 id="trust-title">Public verification — no account needed</h2></div>
        <p className="muted landing-trust-note">{LANDING_COPY.publicNote}</p>
        <div className="trust-links">
          {TRUST_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="card trust-link"><strong>{l.title}</strong><span className="muted small">{l.text}</span><span className="trust-arrow" aria-hidden>→</span></Link>
          ))}
        </div>
      </section>
    </Page>
  );
}
