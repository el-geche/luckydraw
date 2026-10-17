import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
const Digit = ({ value, label }) => (
  <div className="cd-unit">
    <div className="cd-value">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={value} initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          {String(value).padStart(2, '0')}
        </motion.span>
      </AnimatePresence>
    </div>
    <div className="cd-label">{label}</div>
  </div>
);

export function Countdown({ to, compact = false, onElapsed }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ms = new Date(to).getTime() - now;
  useEffect(() => { if (ms <= 0 && onElapsed) onElapsed(); }, [ms <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = parts(ms);
  if (compact) {
    if (ms <= 0) return <span className="mono">closing…</span>;
    return <span className="mono cd-compact">{p.d > 0 ? `${p.d}d ` : ''}{String(p.h).padStart(2, '0')}:{String(p.m).padStart(2, '0')}:{String(p.s).padStart(2, '0')}</span>;
  }
  return (
    <div className={`countdown${ms < 60000 ? ' urgent' : ''}`} aria-label="Time remaining">
      <Digit value={p.d} label="days" /><span className="cd-sep">:</span>
      <Digit value={p.h} label="hours" /><span className="cd-sep">:</span>
      <Digit value={p.m} label="min" /><span className="cd-sep">:</span>
      <Digit value={p.s} label="sec" />
    </div>
  );
}
