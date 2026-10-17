import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { OddsTable } from '../components/OddsTable.jsx';
import { DrawWheel } from '../components/DrawWheel.jsx';
import { Card, Hash, ModeChip, StatusBadge, Skeleton, ErrorNote, DemoTag } from '../components/ui.jsx';
import { money, dateTime, pct } from '../lib/format.js';
import { AuditExports } from '../components/AuditExports.jsx';
import { SealPanel, AnchorList, ReportButton } from '../components/Fairness.jsx';

export default function Results() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: d, error } = useApi(`/draws/${id}`);
  if (error) return <Page><ErrorNote error={error} /></Page>;
  if (!d) return <Page><Skeleton h={480} /></Page>;
  if (!d.result) {
    return (
      <Page>
        <Card><h2>Results not yet published</h2><p className="muted">This draw is {d.status}. Results and the full audit record are published the moment the draw is run.</p><Link className="btn btn-gold" to={`/draws/${d.id}`}>Go to draw</Link></Card>
      </Page>
    );
  }
  const r = d.result;
  const winOdds = d.odds.find((o) => o.userId === r.winnerUserId);
  return (
    <Page className="results-page">
      <Rise className="draw-head">
        <div>
          <div className="crumbs"><Link to="/">Draws</Link><span>/</span><Link to={`/draws/${d.id}`}>#{d.id}</Link><span>/</span><span>Results</span></div>
          <h1>{d.title}</h1>
          <div className="head-meta"><StatusBadge status={d.status} /><ModeChip mode={d.mode} /><span className="muted">Drawn {dateTime(d.drawnAt)}</span></div>
        </div>
        <div className="head-actions">
          <Link to={`/draws/${d.id}?watch=1`} className="btn btn-ghost">↻ Watch the draw</Link>
          {d.status === 'drawn' && <Link to={`/draws/${d.id}/winner`} className="btn btn-ghost">Announcement</Link>}
          <ReportButton drawId={d.id} source="results" className="btn btn-ghost" />
          <Link to={`/verify/${d.id}`} className="btn btn-gold">Verify this draw</Link>
        </div>
      </Rise>

      {d.status === 'void' ? <Card><h2>Draw void</h2><p className="muted">No entries were received. The seed has been revealed for audit.</p></Card> : (
        <div className="results-hero">
          <motion.div className="card winner-card" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 22 }}>
            <div className="eyebrow">Winner</div>
            <div className="winner-name">{r.winnerName}</div>
            <div className="winner-sub">Entry #{r.winnerEntryId} · {d.mode === 'weighted' ? `${d.slices.find((s) => s.entryId === r.winnerEntryId)?.tickets} tickets · ` : ''}winning ticket <span className="mono">{r.ticket}</span> of <span className="mono">{r.totalWeight}</span></div>
            <div className="winner-prize"><span>{money(d.prizeCents)}</span><DemoTag>SIMULATED PAYOUT</DemoTag></div>
            <div className="winner-odds">Winner's chance before the draw: <strong className="gold">{pct(winOdds?.probability ?? 0, 2)}</strong></div>
            {user?.id === r.winnerUserId && <div className="note note-gold">This is you — the demo prize was credited to your simulated wallet.</div>}
          </motion.div>
          <Card className="mini-wheel"><DrawWheel slices={d.slices} totalWeight={d.totalWeight} result={{ ticket: r.ticket, totalWeight: r.totalWeight, winnerEntryId: r.winnerEntryId }} restOnResult size={300} /></Card>
          <div className="stat-stack">
            <Stat label="Entries" value={d.stats.entries} />
            <Stat label="Participants" value={d.stats.participants} />
            <Stat label={d.mode === 'weighted' ? 'Total tickets (weight)' : 'Total slices'} value={r.totalWeight} />
            <Stat label="RNG output u" value={<span className="mono">{r.u?.toFixed(12)}</span>} />
          </div>
        </div>
      )}

      <Rise className="section"><Card>
        <div className="row-between"><h3 className="card-title">Sealed draw</h3><Link className="link small" to={`/verify/${d.id}`}>Recompute in your browser →</Link></div>
        <SealPanel d={d} compact />
        <div className="section-sub"><div className="small muted" style={{ marginBottom: 6 }}>External anchors</div><AnchorList drawId={d.id} /></div>
      </Card></Rise>

      <Rise className="section">
        <div className="section-head"><h2>Odds breakdown <span className="count">per participant</span></h2></div>
        <Card>
          <p className="muted small">{d.mode === 'equal' ? 'Equal mode: every entry is one slice of weight 1, so a participant’s chance = their entries ÷ total entries.' : 'Weighted mode: each entry’s weight equals its ticket count, so a participant’s chance = their tickets ÷ total tickets.'}</p>
          <OddsTable odds={d.odds} mode={d.mode} totalWeight={d.totalWeight} winnerUserId={r.winnerUserId} highlightUserId={user?.id} />
        </Card>
      </Rise>

      <div className="two-col section">
        <Rise><Card>
          <div className="row-between"><h3 className="card-title">Published audit record</h3></div>
          <dl className="kv">
            <dt>Algorithm</dt><dd className="mono">{r.algorithm}</dd>
            <dt>Mode</dt><dd>{r.mode}</dd>
            <dt>Server seed (revealed)</dt><dd><Hash value={r.serverSeed} label="server seed" /></dd>
            <dt>Commitment</dt><dd><Hash value={r.commitment} label="commitment" /></dd>
            <dt>Sealed chain hash</dt><dd><Hash value={r.sealHash} label="sealed hash" /></dd>
            <dt>Crowd entropy</dt><dd><Hash value={r.crowdEntropy} label="crowd entropy" /></dd>
            <dt>Beacon</dt><dd className="small">{r.publicEntropy?.value ? <>drand <a className="link mono" href={r.publicEntropy.url} target="_blank" rel="noreferrer">#{r.publicEntropy.round}</a></> : <span className="muted">{r.publicEntropy?.source ?? 'none'}</span>}</dd>
            <dt>Final seed</dt><dd><Hash value={r.finalSeed} label="final seed" /></dd>
            <dt>Entries hash</dt><dd><Hash value={r.entriesHash} label="entries hash" /></dd>
            <dt>u = rng()</dt><dd className="mono">{r.u}</dd>
            <dt>ticket</dt><dd className="mono">floor({r.u?.toFixed(6)} × {r.totalWeight}) = {r.ticket}</dd>
          </dl>
          <AuditExports drawId={d.id} />
        </Card></Rise>
        <Rise><Card>
          <h3 className="card-title">Ordered entry list <span className="count">{r.entries.length}</span></h3>
          <div className="table-wrap scroll-y">
            <table className="table compact">
              <thead><tr><th>#</th><th>Entry</th><th>Participant</th>{d.mode === 'weighted' && <th className="num">Tickets</th>}<th className="num">Ticket range</th></tr></thead>
              <tbody>
                {d.slices.map((s, i) => (
                  <tr key={s.entryId} className={s.entryId === r.winnerEntryId ? 'row-winner' : ''}>
                    <td className="muted">{i + 1}</td><td className="mono">#{s.entryId}</td><td>{s.name}</td>
                    {d.mode === 'weighted' && <td className="num">{s.tickets}</td>}
                    <td className="num mono">{s.weight === 1 ? s.start : `${s.start}–${s.end - 1}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card></Rise>
      </div>
    </Page>
  );
}
const Stat = ({ label, value }) => <div className="stat"><span className="muted small">{label}</span><strong>{value}</strong></div>;
