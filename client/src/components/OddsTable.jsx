import { motion } from 'framer-motion';
import { pct } from '../lib/format.js';

export function OddsTable({ odds, mode, winnerUserId, highlightUserId, totalWeight }) {
  if (!odds?.length) return <div className="muted">No entries yet.</div>;
  return (
    <div className="table-wrap">
      <table className="table odds">
        <thead>
          <tr><th>Participant</th><th className="num">Entries</th>{mode === 'weighted' && <th className="num">Tickets</th>}<th className="num">Weight</th><th style={{ width: '34%' }}>Chance of winning</th></tr>
        </thead>
        <tbody>
          {odds.map((o, i) => (
            <motion.tr key={o.userId} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
              className={`${o.userId === winnerUserId ? 'row-winner' : ''} ${o.userId === highlightUserId ? 'row-mine' : ''}`}>
              <td>{o.name}{o.userId === winnerUserId && <span className="winner-mark">Winner</span>}{o.userId === highlightUserId && <span className="you-mark">You</span>}</td>
              <td className="num">{o.entries}</td>
              {mode === 'weighted' && <td className="num">{o.tickets}</td>}
              <td className="num mono">{o.weight}/{totalWeight}</td>
              <td>
                <div className="bar"><motion.div className="bar-fill" initial={{ width: 0 }} animate={{ width: `${o.probability * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.1 + i * 0.03 }} /></div>
                <span className="bar-label mono">{pct(o.probability, 2)}</span>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
