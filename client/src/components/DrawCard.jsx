import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { money, dateOnly } from '../lib/format.js';
import { StatusBadge, ModeChip } from './ui.jsx';
import { Countdown } from './Countdown.jsx';

export function DrawCard({ d, i = 0 }) {
  const to = d.status === 'drawn' || d.status === 'void' ? `/draws/${d.id}/results` : `/draws/${d.id}`;
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }} className="draw-card-wrap">
      <Link to={to} className={`card draw-card status-${d.status}`}>
        <div className="draw-card-top"><StatusBadge status={d.status} /><ModeChip mode={d.mode} /></div>
        <h3 className="draw-card-title">{d.title}</h3>
        <div className="draw-card-prize"><span className="muted small">Prize</span><span className="prize">{money(d.prizeCents)}</span><span className="tag-demo">DEMO</span></div>
        <div className="draw-card-meta">
          <div><span className="muted small">Entries</span><strong>{d.stats.entries}</strong></div>
          <div><span className="muted small">Players</span><strong>{d.stats.participants}</strong></div>
          <div className="meta-wide">
            {d.status === 'open' ? (<><span className="muted small">Closes in</span><strong><Countdown to={d.closesAt} compact /></strong></>)
              : d.status === 'closed' ? (<><span className="muted small">Closed</span><strong>{dateOnly(d.closedAt || d.closesAt)}</strong></>)
                : (<><span className="muted small">Winner</span><strong className="gold">{d.winner?.name ?? '—'}</strong></>)}
          </div>
        </div>
        <div className="draw-card-cta">{d.status === 'open' ? 'Enter draw' : d.status === 'closed' ? 'Watch the draw' : 'View results & audit'} <span aria-hidden>→</span></div>
      </Link>
    </motion.div>
  );
}
