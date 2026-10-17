import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { DrawCard } from '../components/DrawCard.jsx';
import { Countdown } from '../components/Countdown.jsx';
import { Hash, Skeleton, ModeChip, Empty } from '../components/ui.jsx';
import { money } from '../lib/format.js';

export default function Home() {
  const { data: draws, loading } = useApi('/draws', { poll: 5000 });
  const open = draws?.filter((d) => d.status === 'open') ?? [];
  const closed = draws?.filter((d) => d.status === 'closed') ?? [];
  const done = draws?.filter((d) => d.status === 'drawn' || d.status === 'void') ?? [];
  const featured = open[0];
  const totalPaid = done.reduce((s, d) => s + (d.winner ? d.prizeCents : 0), 0);

  return (
    <Page>
      <section className="hero">
        <Rise className="hero-copy">
          <div className="eyebrow">Commit–reveal · Sealed audit chain · Bitcoin-anchored</div>
          <h1>Draws you can <span className="gold">verify</span>, not just trust.</h1>
          <p className="lead">
            Every LuckyDraw commits to a hidden seed before entries open, seals a tamper-evident audit chain at close and
            anchors it externally. After the draw anyone can recompute every step, and the winner, in their browser.
          </p>
          <div className="hero-actions">
            <Link to={featured ? `/draws/${featured.id}` : '/verify'} className="btn btn-gold btn-lg">{featured ? 'Enter the current draw' : 'Verify a draw'}</Link>
            <Link to="/upcoming" className="btn btn-ghost btn-lg">Upcoming draws</Link>
            <Link to="/faq" className="link hero-link">How fairness works →</Link>
          </div>
          <div className="hero-stats">
            <div><strong>{done.length}</strong><span>completed draws</span></div>
            <div><strong>{money(totalPaid)}</strong><span>demo prizes paid</span></div>
            <div><strong>5</strong><span>max entries per person</span></div>
          </div>
        </Rise>
        <Rise className="hero-feature">
          {loading && !draws ? <Skeleton h={300} /> : featured ? (
            <Link to={`/draws/${featured.id}`} className="card feature-card">
              <div className="feature-head"><span className="badge badge-open"><span className="pulse" />Open now</span><ModeChip mode={featured.mode} /></div>
              <h2>{featured.title}</h2>
              <p className="muted">{featured.description}</p>
              <div className="feature-prize"><span>{money(featured.prizeCents)}</span><span className="tag-demo">DEMO PRIZE</span></div>
              <Countdown to={featured.closesAt} />
              <div className="feature-foot">
                <span className="muted small">Seed commitment</span>
                <Hash value={featured.seedCommitment} n={14} label="commitment" />
              </div>
            </Link>
          ) : <Empty title="No open draws right now">Check back soon, or review past results below.</Empty>}
        </Rise>
      </section>

      <Section title="Open draws" count={open.length}>
        {open.length ? <div className="grid-cards">{open.map((d, i) => <DrawCard key={d.id} d={d} i={i} />)}</div> : <Empty title="Nothing open">New draws are announced here.</Empty>}
      </Section>
      {closed.length > 0 && (
        <Section title="Closed — awaiting draw" count={closed.length}>
          <div className="grid-cards">{closed.map((d, i) => <DrawCard key={d.id} d={d} i={i} />)}</div>
        </Section>
      )}
      <Section title="Recent results" count={done.length} action={<Link to="/verify" className="link">Verify any result →</Link>}>
        <div className="grid-cards">{done.map((d, i) => <DrawCard key={d.id} d={d} i={i} />)}</div>
      </Section>

      <section className="trust-strip">
        {[
          ['1', 'Commit', 'At open the server generates a secret seed and publishes only sha256(seed), anchored with OpenTimestamps. The seed itself never leaves the server.'],
          ['2', 'Seal', 'Every entry adds a hash-chained, append-only confirmation record. At close the final chain hash is sealed and anchored to Bitcoin via OpenTimestamps.'],
          ['3', 'Mix', 'Crowd entropy (SHA-256 of all receipt codes) is combined with a drand beacon round fixed after close, then HMAC-keyed with the seed and the sealed hash.'],
          ['4', 'Reveal & verify', 'The seed is revealed and the wheel spins. One click on the verify page recomputes the chain, anchors, seed derivation and winner in your browser.'],
        ].map(([n, t, d], i) => (
          <motion.div key={n} className="trust-item" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.08 }}>
            <span className="trust-n">{n}</span><div><strong>{t}</strong><p className="muted">{d}</p></div>
          </motion.div>
        ))}
      </section>
    </Page>
  );
}

function Section({ title, count, action, children }) {
  return (
    <section className="section">
      <div className="section-head"><h2>{title} {count != null && <span className="count">{count}</span>}</h2>{action}</div>
      {children}
    </section>
  );
}
