import { useState } from 'react';
import { motion } from 'framer-motion';
import { shortHash } from '../lib/format.js';

export const StatusBadge = ({ status }) => {
  const labels = { scheduled: 'Scheduled', open: 'Open', closed: 'Closed · sealed', drawn: 'Drawn', void: 'Void' };
  return <span className={`badge badge-${status}`}>{status === 'open' && <span className="pulse" />}{labels[status] ?? status}</span>;
};
export const ModeChip = ({ mode }) => (
  <span className="chip" title={mode === 'equal' ? 'One entry = one equal slice' : 'Slice size proportional to tickets in the entry'}>
    {mode === 'equal' ? 'Equal entry' : 'Weighted'}
  </span>
);
export const DemoTag = ({ children = 'DEMO' }) => <span className="tag-demo">{children}</span>;

export function Hash({ value, n = 10, full = false, label }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="mono muted">sealed</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button type="button" className={`hash mono${full ? ' hash-full' : ''}`} onClick={copy} title={`Copy ${label || 'value'}`}>
      <span>{full ? value : shortHash(value, n)}</span>
      <span className="hash-copy">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export function Button({ children, className = 'btn-gold', loading, ...props }) {
  return (
    <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`btn ${className}`} disabled={loading || props.disabled} {...props}>
      {loading ? <span className="spinner" aria-label="Loading" /> : children}
    </motion.button>
  );
}

export const Card = ({ children, className = '', hover = false, ...p }) => (
  <motion.div className={`card ${className}`} whileHover={hover ? { y: -3, transition: { type: 'spring', stiffness: 400, damping: 28 } } : undefined} {...p}>{children}</motion.div>
);

export const Skeleton = ({ h = 120 }) => <div className="skeleton" style={{ height: h }} />;

export const Empty = ({ title, children }) => (
  <div className="empty"><div className="empty-title">{title}</div>{children && <div className="muted">{children}</div>}</div>
);

export const ErrorNote = ({ error }) => error ? <div className="note note-danger">{error.message || String(error)}</div> : null;

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab${value === t.value ? ' active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
          {value === t.value && <motion.span layoutId={`tab-ind-${tabs.map((x) => x.value).join('')}`} className="tab-ind" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        </button>
      ))}
    </div>
  );
}
