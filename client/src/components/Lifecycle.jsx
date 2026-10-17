import { motion } from 'framer-motion';

const STEPS = [
  { key: 'open', label: 'Open', hint: 'Entries accepted; seed hash committed' },
  { key: 'countdown', label: 'Countdown', hint: 'Closing time approaching' },
  { key: 'closed', label: 'Closed', hint: 'Entry list frozen' },
  { key: 'drawing', label: 'Draw', hint: 'Seed revealed, wheel spins' },
  { key: 'results', label: 'Results', hint: 'Audit record published' },
];

export function Lifecycle({ status, spinning = false, closesAt }) {
  const soon = status === 'open' && new Date(closesAt).getTime() - Date.now() < 24 * 3600_000;
  let idx = 0;
  if (status === 'open') idx = soon ? 1 : 0;
  if (status === 'closed') idx = 2;
  if (status === 'drawn' || status === 'void') idx = spinning ? 3 : 4;
  return (
    <ol className="lifecycle" aria-label="Draw lifecycle">
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < idx ? 'done' : i === idx ? 'current' : ''} title={s.hint}>
          <span className="lc-dot">
            {i === idx && <motion.span className="lc-ring" layoutId="lc-ring" transition={{ type: 'spring', stiffness: 300, damping: 30 }} />}
            {i < idx ? '✓' : i + 1}
          </span>
          <span className="lc-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
