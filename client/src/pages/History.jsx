import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { Card, ModeChip, StatusBadge, Skeleton, Empty, Hash } from '../components/ui.jsx';
import { money, dateTime } from '../lib/format.js';

export default function History() {
  const { data, loading } = useApi('/draws?status=drawn,void');
  const [mode, setMode] = useState('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data ?? []).filter((d) => (mode === 'all' || d.mode === mode) && (!q || `${d.title} ${d.winner?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, mode, q]);
  const paid = (data ?? []).reduce((s, d) => s + (d.winner ? d.prizeCents : 0), 0);
  const entries = (data ?? []).reduce((s, d) => s + d.stats.entries, 0);
  return (
    <Page className="history">
      <Rise className="page-head">
        <div><div className="eyebrow">Public record</div><h1>Draw history</h1><p className="lead small-lead">Every completed draw, its winner, its sealed audit-chain hash and revealed seed. Winners are shown by masked display name only.</p></div>
        <div className="history-stats"><div><strong>{data?.length ?? '—'}</strong><span>draws</span></div><div><strong>{entries}</strong><span>entries</span></div><div><strong>{money(paid)}</strong><span>demo prizes</span></div></div>
      </Rise>
      <Rise className="toolbar">
        <div className="seg seg-inline">
          {['all', 'equal', 'weighted'].map((m) => (
            <button key={m} className={`seg-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>{mode === m && <motion.span layoutId="hist-mode" className="seg-ind" />}<span>{m === 'all' ? 'All' : m === 'equal' ? 'Equal' : 'Weighted'}</span></button>
          ))}
        </div>
        <input className="input input-search" placeholder="Search draw or winner…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" />
      </Rise>
      {loading && !data ? <Skeleton h={300} /> : !rows.length ? <Empty title="No matching draws" /> : (
        <Card className="table-wrap">
          <table className="table history-table">
            <thead><tr><th>Draw</th><th>Mode</th><th>Drawn</th><th className="num">Entries</th><th className="num">Prize</th><th>Winner</th><th>Sealed hash</th><th /></tr></thead>
            <tbody>
              {rows.map((d, i) => (
                <motion.tr key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}>
                  <td><Link className="link-plain" to={`/draws/${d.id}/results`}><span className="muted">#{d.id}</span> {d.title}</Link></td>
                  <td><ModeChip mode={d.mode} /></td>
                  <td className="small muted nowrap">{dateTime(d.drawnAt)}</td>
                  <td className="num">{d.stats.entries} <span className="muted small">/ {d.stats.participants}p</span></td>
                  <td className="num">{money(d.prizeCents)}</td>
                  <td>{d.winner ? <strong className="gold">{d.winner.name}</strong> : <StatusBadge status="void" />}</td>
                  <td><Hash value={d.seal?.hash} n={8} label="sealed hash" /><div className="small muted">{d.seal?.count ?? 0} records</div></td>
                  <td className="actions nowrap"><Link className="btn btn-ghost btn-xs" to={`/draws/${d.id}/results`}>Results</Link>{d.winner && <Link className="btn btn-ghost btn-xs" to={`/draws/${d.id}/winner`}>Winner</Link>}<Link className="btn btn-gold btn-xs" to={`/verify/${d.id}`}>Verify</Link></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
