import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi.js';
import { Hash } from './ui.jsx';
import { dateTime, utcTime } from '../lib/format.js';

const ANCHOR_LABEL = { pending: 'Pending', submitted: 'Submitted · awaiting Bitcoin', confirmed: 'Confirmed', failed: 'Retrying' };
export const AnchorBadge = ({ status }) => <span className={`badge anchor-${status}`}>{status === 'confirmed' ? '✓ ' : ''}{ANCHOR_LABEL[status] ?? status}</span>;

/** Fairness-report PDF download (seed is withheld in the PDF until the draw is sealed and run). */
export const ReportButton = ({ drawId, source = 'other', className = 'btn btn-ghost btn-sm' }) => (
  <a className={className} href={`/api/draws/${drawId}/report.pdf?source=${source}`} download>↓ Fairness report (PDF)</a>
);

/** Commitment + seal + beacon summary shown on draw / results / history pages. */
export function SealPanel({ d, compact = false }) {
  const sealed = Boolean(d.seal?.hash);
  return (
    <div className={`seal-panel${compact ? ' compact' : ''}`}>
      <div className="seal-row"><span className="seal-k">Seed commitment</span><Hash value={d.seedCommitment} n={12} label="seed commitment" /><span className="small muted">sha256(serverSeed), published at open</span></div>
      <div className="seal-row">
        <span className="seal-k">Sealed chain hash</span>
        {sealed ? <><Hash value={d.seal.hash} n={12} label="sealed hash" /><span className="small muted">{d.seal.count} records · sealed {dateTime(d.seal.sealedAt)} <span className="mono">({utcTime(d.seal.sealedAt)})</span></span></>
          : <span className="sealed">Not sealed yet — sealed automatically at close</span>}
      </div>
      {d.entropy?.round && (
        <div className="seal-row"><span className="seal-k">Public beacon</span>
          <span className="small">drand round <a className="link mono" href={d.entropy.url} target="_blank" rel="noreferrer">{d.entropy.round}</a>{' '}
            {d.entropy.value ? <Hash value={d.entropy.value} n={10} label="beacon value" /> : <span className="muted">— value published by drand at {dateTime(d.entropy.availableAt)}</span>}</span>
        </div>
      )}
      {!compact && sealed && <div className="seal-row"><span className="seal-k" /><Link className="link small" to={`/verify/${d.id}`}>Recompute the chain and seed in your browser →</Link></div>}
    </div>
  );
}

export function AnchorList({ drawId, kind }) {
  const { data } = useApi(`/draws/${drawId}/anchors`, { poll: 20000 });
  const rows = (data ?? []).filter((a) => !kind || a.kind === kind);
  if (!rows.length) return <div className="muted small">No external anchors recorded{kind === 'seal' ? ' (the seal is anchored at close)' : ''}.</div>;
  return (
    <ul className="anchor-list">
      {rows.map((a, i) => (
        <motion.li key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
          <div className="row-between"><strong className="small">{a.kind === 'seal' ? 'Sealed hash' : 'Seed commitment'} · {a.provider === 'opentimestamps' ? 'OpenTimestamps' : a.provider === 'rfc3161' ? 'RFC 3161 TSA' : a.provider}</strong><AnchorBadge status={a.status} /></div>
          <div className="small muted">digest <span className="mono">{a.digest.slice(0, 16)}…</span>{a.submittedAt && <> · submitted {dateTime(a.submittedAt)}</>}{a.bitcoinBlock && <> · Bitcoin block <strong className="gold">{a.bitcoinBlock}</strong></>}{a.attempts > 1 && !a.hasProof && <> · {a.attempts} attempts</>}</div>
          {a.hasProof && <a className="link small" href={`/api/draws/${drawId}/anchors/${a.id}/proof.${a.proofFormat}`} download>↓ Download .{a.proofFormat} proof</a>}
        </motion.li>
      ))}
    </ul>
  );
}
