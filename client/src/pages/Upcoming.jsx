import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Countdown } from '../components/Countdown.jsx';
import { Card, Hash, ModeChip, Skeleton, Empty, Button } from '../components/ui.jsx';
import { money, utcTime, localTz } from '../lib/format.js';

const fmtLocal = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const PERIODS = [{ v: 'all', l: 'Next 8 weeks' }, { v: 'week', l: 'This week' }, { v: 'month', l: 'This month' }];
const PRIZES = [{ v: 0, l: 'Any prize' }, { v: 10000, l: '$100+' }, { v: 25000, l: '$250+' }, { v: 50000, l: '$500+' }];

export default function Upcoming() {
  const { data, loading } = useApi('/upcoming?weeks=8', { poll: 30000 });
  const [period, setPeriod] = useState('all');
  const [minPrize, setMinPrize] = useState(0);
  const rows = useMemo(() => {
    const now = Date.now();
    const lim = period === 'week' ? now + 7 * 86400_000 : period === 'month' ? now + 31 * 86400_000 : Infinity;
    return (data ?? []).filter((d) => new Date(d.closesAt).getTime() <= lim && d.prizeCents >= minPrize);
  }, [data, period, minPrize]);
  const openCount = rows.filter((r) => r.kind === 'open').length;
  return (
    <Page className="upcoming">
      <Rise className="page-head"><div>
        <div className="eyebrow">Draw calendar</div><h1>Upcoming draws</h1>
        <p className="lead small-lead">Open draws and the scheduled programme for the next eight weeks. Times are shown in your time zone ({localTz()}) with UTC alongside. Scheduled draws publish their seed commitment the moment they open.</p>
      </div>
      <div className="history-stats"><div><strong>{openCount}</strong><span>open now</span></div><div><strong>{rows.length - openCount}</strong><span>scheduled</span></div></div></Rise>
      <Rise className="toolbar">
        <div className="seg seg-inline">{PERIODS.map((p) => (
          <button key={p.v} className={`seg-btn${period === p.v ? ' active' : ''}`} onClick={() => setPeriod(p.v)}>{period === p.v && <motion.span layoutId="up-period" className="seg-ind" />}<span>{p.l}</span></button>
        ))}</div>
        <select className="input input-sm filter" value={minPrize} onChange={(e) => setMinPrize(Number(e.target.value))} aria-label="Minimum prize">{PRIZES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</select>
      </Rise>
      {loading && !data ? <Skeleton h={320} /> : !rows.length ? <Empty title="No draws match these filters" /> : (
        <motion.div className="grid-up" layout>
          <AnimatePresence>
            {rows.map((d, i) => <UpCard key={d.drawId ?? `p-${d.closesAt}-${d.title}`} d={d} i={i} />)}
          </AnimatePresence>
        </motion.div>
      )}
    </Page>
  );
}

function UpCard({ d, i }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const open = d.kind === 'open';
  const enter = () => {
    const target = d.drawId ? `/draws/${d.drawId}` : '/upcoming';
    nav(user ? target : `/login?next=${encodeURIComponent(target)}`);
  };
  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.04, 0.4) } }} exit={{ opacity: 0, scale: 0.97 }}>
      <Card className={`up-card${open ? ' is-open' : ''}`} hover>
        <div className="draw-card-top">
          <span className={`badge ${open ? 'badge-open' : 'badge-scheduled'}`}>{open && <span className="pulse" />}{open ? 'Open now' : 'Scheduled'}</span>
          <ModeChip mode={d.mode} />
        </div>
        <h3 className="draw-card-title">{d.title}</h3>
        <div className="draw-card-prize"><span className="prize">{money(d.prizeCents)}</span><span className="tag-demo">DEMO</span></div>
        <dl className="up-times">
          <dt>Opens</dt><dd>{fmtLocal(d.opensAt)}<span className="mono small muted">{utcTime(d.opensAt)}</span></dd>
          <dt>Closes</dt><dd>{fmtLocal(d.closesAt)}<span className="mono small muted">{utcTime(d.closesAt)}</span></dd>
        </dl>
        <div className="draw-card-meta">
          <div><span className="muted small">Cap</span><strong>{d.maxEntriesPerUser} / person</strong></div>
          <div><span className="muted small">Entry</span><strong>{money(d.entryPriceCents)}</strong></div>
          <div><span className="muted small">Entries</span><strong>{open ? d.entries : '—'}</strong></div>
        </div>
        {open ? <Countdown to={d.closesAt} compact /> : <div className="small muted">Opens {new Date(d.opensAt) > new Date() ? <Countdown to={d.opensAt} compact /> : 'shortly'}</div>}
        {open && d.seedCommitment && <div className="small"><span className="muted">Seed commitment </span><Hash value={d.seedCommitment} n={8} label="seed commitment" /></div>}
        <div className="up-cta">
          {open ? <Button className="btn-gold btn-sm" onClick={enter}>{user ? 'Enter draw' : 'Sign in to enter'}</Button>
            : d.drawId ? <Link className="btn btn-ghost btn-sm" to={`/draws/${d.drawId}`}>Details</Link> : <span className="small muted">Projected from the weekly schedule</span>}
        </div>
      </Card>
    </motion.div>
  );
}
