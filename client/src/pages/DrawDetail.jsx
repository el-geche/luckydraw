import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { DrawWheel } from '../components/DrawWheel.jsx';
import { Countdown } from '../components/Countdown.jsx';
import { Lifecycle } from '../components/Lifecycle.jsx';
import { OddsTable } from '../components/OddsTable.jsx';
import { Button, Card, Hash, ModeChip, StatusBadge, Skeleton, ErrorNote, DemoTag } from '../components/ui.jsx';
import { money, dateTime, pct } from '../lib/format.js';
import { ReportButton } from '../components/Fairness.jsx';

export default function DrawDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [pollMs, setPollMs] = useState(3000);
  const { data: d, error, reload } = useApi(`/draws/${id}`, { poll: pollMs });
  const wheel = useRef(null);
  const prevStatus = useRef(null);
  const [phase, setPhase] = useState('idle'); // idle | spinning | landed
  const autoplay = useRef(params.get('watch') === '1');
  const [spinQueued, setSpinQueued] = useState(false);

  // Detect the transition to "drawn" (live) or ?watch=1 and play the spin once.
  useEffect(() => {
    if (!d) return;
    const was = prevStatus.current;
    prevStatus.current = d.status;
    if (d.status === 'drawn') {
      setPollMs(0);
      const live = was === 'open' || was === 'closed';
      if ((live || autoplay.current) && phase === 'idle') {
        autoplay.current = false;
        setSpinQueued(true);
        setTimeout(() => startSpin(), 450);
      }
    } else if (d.status === 'void') setPollMs(0);
    else setPollMs(d.status === 'closed' || new Date(d.closesAt) - Date.now() < 120000 ? 1500 : 4000);
  }, [d?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSpin = () => { setSpinQueued(false); setPhase('spinning'); wheel.current?.spin(); };

  if (error) return <Page><ErrorNote error={error} /></Page>;
  if (!d) return <Page><Skeleton h={480} /></Page>;

  const drawn = d.status === 'drawn';
  // Never rest on (and thus reveal) the result if a live spin is about to play.
  const willAutoSpin = prevStatus.current === 'open' || prevStatus.current === 'closed' || autoplay.current;
  const restOnResult = drawn && phase === 'idle' && !willAutoSpin && !spinQueued;
  const myCount = d.myEntries?.length ?? 0;

  return (
    <Page className="draw-page">
      <Rise className="draw-head">
        <div>
          <div className="crumbs"><Link to="/">Draws</Link><span>/</span><span>#{d.id}</span></div>
          <h1>{d.title}</h1>
          <div className="head-meta"><StatusBadge status={d.status} /><ModeChip mode={d.mode} /><span className="muted">Cap {d.maxEntriesPerUser} entries / person</span>{d.autoDraw && <span className="chip chip-soft">Auto-draw at close</span>}</div>
        </div>
        <div className="head-prize"><span className="muted small">Prize</span><span className="prize-lg">{money(d.prizeCents)}</span><DemoTag>DEMO · SIMULATED</DemoTag></div>
      </Rise>
      <Rise><Lifecycle status={d.status} spinning={phase === 'spinning'} closesAt={d.closesAt} /></Rise>

      <div className="draw-grid">
        <Rise className="wheel-col">
          <Card className="wheel-card">
            <DrawWheel ref={wheel} slices={d.slices} totalWeight={d.totalWeight} result={d.result ? { ticket: d.result.ticket, totalWeight: d.result.totalWeight, winnerEntryId: d.result.winnerEntryId } : null}
              restOnResult={restOnResult} onLanded={() => { setPhase('landed'); reload(); }} highlightUserId={user?.id} />
            <div className="wheel-caption">
              {d.status === 'open' && <span className="muted">{d.stats.entries} entries · {d.totalWeight} slice units · the wheel updates live as entries arrive</span>}
              {d.status === 'closed' && <span className="muted"><span className="pulse inline" /> Entries frozen and sealed. {d.runRequested || d.autoDraw ? (d.entropy?.round && !d.entropy.value ? `Waiting for drand round ${d.entropy.round} (public randomness fixed after close)…` : 'The draw will run automatically…') : 'Waiting for the official draw to be triggered…'}</span>}
              {drawn && phase === 'spinning' && <span className="gold">Seed revealed — drawing ticket {d.result.ticket} of {d.result.totalWeight}…</span>}
              {drawn && phase !== 'spinning' && (
                <span className="wheel-actions"><Button className="btn-ghost btn-sm" onClick={startSpin}>↻ Replay draw</Button><Link to={`/draws/${d.id}/results`} className="btn btn-gold btn-sm">Full results & odds</Link></span>
              )}
              {d.status === 'void' && <span className="muted">This draw closed with no entries and was voided. Seed revealed for audit.</span>}
            </div>
          </Card>
          <AnimatePresence>
            {drawn && phase === 'landed' && d.winner && (
              <motion.div className="winner-reveal card" initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 24 }}>
                <div className="eyebrow">Winner</div>
                <div className="winner-name">{d.winner.name}</div>
                <div className="muted">Entry #{d.winner.entryId} · ticket {d.result.ticket} of {d.result.totalWeight} · {money(d.prizeCents)} paid to demo wallet</div>
                {user?.id === d.winner.userId && <div className="note note-gold">Congratulations — the demo prize has been credited to your simulated wallet.</div>}
                <div className="row-gap"><Link to={`/draws/${d.id}/results`} className="btn btn-gold">View results & odds breakdown →</Link><Link to={`/draws/${d.id}/winner`} className="btn btn-ghost">Announcement</Link></div>
              </motion.div>
            )}
          </AnimatePresence>
        </Rise>

        <div className="side-col">
          {d.status === 'open' && (
            <Rise><Card className="countdown-card">
              <div className="row-between"><span className="eyebrow">Closes in</span><span className="muted small">{dateTime(d.closesAt)}</span></div>
              <Countdown to={d.closesAt} onElapsed={() => setTimeout(reload, 2500)} />
            </Card></Rise>
          )}
          {d.status === 'open' && <Rise><EntryPanel d={d} myCount={myCount} onEntered={reload} /></Rise>}
          <Rise><FairnessCard d={d} /></Rise>
          {myCount > 0 && (
            <Rise><Card>
              <h3 className="card-title">Your entries <span className="count">{myCount}/{d.maxEntriesPerUser}</span></h3>
              <ul className="entry-chips">{d.myEntries.map((e) => <li key={e.entryId} className={d.winner?.entryId === e.entryId ? 'win' : ''}>#{e.entryId}{d.mode === 'weighted' && <span> · {e.tickets}t</span>}</li>)}</ul>
              <div className="muted small">Your current chance: <strong className="gold">{pct(d.odds.find((o) => o.userId === user?.id)?.probability ?? 0, 2)}</strong></div>
            </Card></Rise>
          )}
        </div>
      </div>

      <Rise className="section">
        <div className="section-head"><h2>{drawn ? 'Final odds' : 'Live odds'} <span className="count">{d.odds.length} participants</span></h2></div>
        <Card><OddsTable odds={d.odds} mode={d.mode} totalWeight={d.totalWeight} winnerUserId={phase !== 'spinning' && !spinQueued ? d.winner?.userId : null} highlightUserId={user?.id} /></Card>
      </Rise>
    </Page>
  );
}

function EntryPanel({ d, myCount, onEntered }) {
  const { user, balanceCents, refresh } = useAuth();
  const toast = useToast();
  const remaining = d.maxEntriesPerUser - myCount;
  const [count, setCount] = useState(1);
  const [tickets, setTickets] = useState(d.mode === 'weighted' ? 3 : 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [lastReceipt, setLastReceipt] = useState(null);
  useEffect(() => { if (count > remaining) setCount(Math.max(1, remaining)); }, [remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <Card><h3 className="card-title">Enter this draw</h3><p className="muted">Sign in with a demo account to enter. No real money is involved.</p><Link className="btn btn-gold" to={`/login?next=/draws/${d.id}`}>Sign in to enter</Link></Card>;
  const cost = d.entryPriceCents * count * (d.mode === 'weighted' ? tickets : 1);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api(`/draws/${d.id}/entries`, { method: 'POST', body: { count, tickets } });
      toast(`${count} entr${count === 1 ? 'y' : 'ies'} confirmed · receipt ${r.receipt.code} emailed to your Demo outbox`, 'success');
      setLastReceipt(r.receipt);
      await Promise.all([onEntered(), refresh()]);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card className="entry-panel">
      <div className="row-between"><h3 className="card-title">Enter this draw</h3><DemoTag /></div>
      <AnimatePresence>
        {lastReceipt && (
          <motion.div className="receipt-mini" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="small muted">Proof of entry · entries {lastReceipt.entryIds.map((i) => `#${i}`).join(', ')}</div>
            <div className="mono gold">{lastReceipt.code}</div>
            <div className="row-gap small"><Link className="link" to={`/verify-receipt?code=${lastReceipt.code}`}>Verify receipt</Link><Link className="link" to="/outbox">Open Demo outbox</Link></div>
          </motion.div>
        )}
      </AnimatePresence>
      {remaining <= 0 ? (
        <div className="note">You hold the maximum of {d.maxEntriesPerUser} entries for this draw.</div>
      ) : (
        <>
          <label className="field-label">Entries <span className="muted">({remaining} of {d.maxEntriesPerUser} remaining)</span></label>
          <div className="seg">
            {Array.from({ length: d.maxEntriesPerUser }, (_, i) => i + 1).map((n) => (
              <button key={n} disabled={n > remaining} className={`seg-btn${count === n ? ' active' : ''}`} onClick={() => setCount(n)}>
                {count === n && <motion.span layoutId="seg-count" className="seg-ind" />}<span>{n}</span>
              </button>
            ))}
          </div>
          {d.mode === 'weighted' && (
            <>
              <label className="field-label">Tickets per entry <span className="muted">(weight 1–10)</span></label>
              <input type="range" min="1" max="10" value={tickets} onChange={(e) => setTickets(Number(e.target.value))} className="range" />
              <div className="row-between small muted"><span>1</span><strong className="gold">{tickets} ticket{tickets > 1 ? 's' : ''} · slice ×{tickets}</strong><span>10</span></div>
            </>
          )}
          <div className="cost-row"><span className="muted">Cost (simulated)</span><strong>{money(cost)}</strong></div>
          <div className="cost-row small"><span className="muted">Demo balance after</span><span className={balanceCents - cost < 0 ? 'danger' : ''}>{money((balanceCents ?? 0) - cost)}</span></div>
          <ErrorNote error={err} />
          <Button onClick={submit} loading={busy} disabled={cost > (balanceCents ?? 0)} className="btn-gold btn-block">Confirm {count} entr{count === 1 ? 'y' : 'ies'}</Button>
          {cost > (balanceCents ?? 0) && <div className="small muted">Insufficient demo balance — <Link to="/dashboard" className="link">add demo funds</Link>.</div>}
        </>
      )}
    </Card>
  );
}

function FairnessCard({ d }) {
  const revealed = d.status === 'drawn' || d.status === 'void';
  return (
    <Card className="fair-card">
      <h3 className="card-title">Fairness record</h3>
      <dl className="kv">
        <dt>Algorithm</dt><dd className="mono">luckydraw-v1 · seed v3</dd>
        <dt>Seed commitment</dt><dd><Hash value={d.seedCommitment} label="commitment" /></dd>
        <dt>Server seed</dt><dd>{revealed && d.seed ? <Hash value={d.seed} label="seed" /> : <span className="sealed">🔒 withheld until sealed and drawn</span>}</dd>
        <dt>Sealed hash</dt><dd>{d.seal?.hash ? <Hash value={d.seal.hash} label="sealed hash" /> : <span className="sealed">sealed at close</span>}</dd>
        {d.entropy?.round && (<><dt>Beacon</dt><dd className="small">drand <a className="link mono" href={d.entropy.url} target="_blank" rel="noreferrer">#{d.entropy.round}</a>{!d.entropy.value && <span className="muted"> · due {dateTime(d.entropy.availableAt)}</span>}</dd></>)}
        <dt>Opened</dt><dd>{dateTime(d.opensAt)}</dd>
        {d.drawnAt && (<><dt>Drawn</dt><dd>{dateTime(d.drawnAt)}</dd></>)}
      </dl>
      <div className="stack-sm">
        {d.seal?.hash ? <Link className="link" to={`/verify/${d.id}`}>Verify this draw →</Link> : <p className="muted small">At close the audit chain is sealed and anchored; after the draw, anyone can recompute every step.</p>}
        {d.status === 'drawn' && <Link className="link small" to={`/draws/${d.id}/winner`}>Winner announcement →</Link>}
        <ReportButton drawId={d.id} source="results" className="link small" />
      </div>
    </Card>
  );
}
