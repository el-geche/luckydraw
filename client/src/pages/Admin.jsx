import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { Button, Card, Hash, ModeChip, StatusBadge, Tabs, Skeleton, ErrorNote, Empty } from '../components/ui.jsx';
import { Countdown } from '../components/Countdown.jsx';
import { money, dateTime } from '../lib/format.js';
import { TrailTab, AnchorsTab, RemindersTab, WinnersTab, CalendarTab, ComplianceTab } from './AdminExtra.jsx';
import { ReportButton } from '../components/Fairness.jsx';

export default function Admin() {
  const { user, ready } = useAuth();
  const [tab, setTabState] = useState(() => new URLSearchParams(location.search).get('tab') || 'draws');
  const setTab = (t) => { setTabState(t); history.replaceState(null, '', `/admin?tab=${t}`); };
  if (ready && !user) return <Navigate to="/login?next=/admin" replace />;
  if (ready && user?.role !== 'admin') return <Page><Card><h2>Admin only</h2><p className="muted">Sign in as <span className="mono">admin@luckydraw.demo</span> to access the console.</p></Card></Page>;
  return (
    <Page className="admin">
      <Rise className="page-head">
        <div><div className="eyebrow">Operator console</div><h1>Admin</h1></div>
        <ResetButton />
      </Rise>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'draws', label: 'Draws' }, { value: 'create', label: 'Create draw' }, { value: 'calendar', label: 'Calendar' }, { value: 'entries', label: 'Entries' }, { value: 'trail', label: 'Audit trail' }, { value: 'anchors', label: 'Anchors' }, { value: 'winners', label: 'Winners' }, { value: 'reminders', label: 'Reminders' }, { value: 'logs', label: 'Logs & seeds' }, { value: 'users', label: 'Users' }, { value: 'access', label: 'Access requests' }, { value: 'mail', label: 'Outbox' }, { value: 'compliance', label: 'Compliance' }]} />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
          {tab === 'draws' && <DrawsTab />}
          {tab === 'create' && <CreateTab onCreated={() => setTab('draws')} />}
          {tab === 'entries' && <EntriesTab />}
          {tab === 'logs' && <LogsTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'access' && <AccessRequestsTab />}
          {tab === 'mail' && <MailTab />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'trail' && <TrailTab />}
          {tab === 'anchors' && <AnchorsTab />}
          {tab === 'winners' && <WinnersTab />}
          {tab === 'reminders' && <RemindersTab />}
          {tab === 'compliance' && <ComplianceTab />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}

function ResetButton() {
  // Hidden unless the server allows destructive resets (off on hosted/production deployments).
  const { data: meta } = useApi('/meta');
  if (!meta?.demoResetEnabled) return null;
  return <ResetControl />;
}

function ResetControl() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api('/admin/reset', { method: 'POST' }); toast('Demo data reset to seed state', 'success'); await refresh(); window.location.reload(); }
    catch (e) { toast(e.message, 'danger'); } finally { setBusy(false); setConfirm(false); }
  };
  return confirm
    ? <div className="row-gap"><span className="muted small">Wipe and reseed all demo data?</span><Button className="btn-danger btn-sm" loading={busy} onClick={go}>Confirm reset</Button><Button className="btn-ghost btn-sm" onClick={() => setConfirm(false)}>Cancel</Button></div>
    : <Button className="btn-ghost btn-sm" onClick={() => setConfirm(true)}>Reset demo data</Button>;
}

function DrawsTab() {
  const { data, error, reload } = useApi('/admin/draws', { poll: 4000 });
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(null);
  const act = async (d, action) => {
    setBusy(`${d.id}:${action}`);
    try {
      if (action === 'close') { await api(`/admin/draws/${d.id}/close`, { method: 'POST' }); toast(`Draw #${d.id} closed — entry list frozen`, 'success'); }
      if (action === 'run') {
        const audit = await api(`/admin/draws/${d.id}/run`, { method: 'POST' });
        if (audit.pending) { toast(`Draw #${d.id} sealed — waiting for drand round ${audit.round}; it will run automatically`, 'info'); await reload(); return; }
        toast(audit.winnerName ? `Draw #${d.id} complete — winner ${audit.winnerName}` : `Draw #${d.id} voided (no entries)`, 'success');
        if (audit.winnerName) nav(`/draws/${d.id}?watch=1`);
      }
      await reload();
    } catch (e) { toast(e.message, 'danger'); } finally { setBusy(null); }
  };
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton h={300} />;
  return (
    <Card className="table-wrap">
      <table className="table">
        <thead><tr><th>#</th><th>Draw</th><th>Mode</th><th>Status</th><th className="num">Entries</th><th className="num">Prize</th><th>Closes / drawn</th><th>Commitment</th><th>Actions</th></tr></thead>
        <tbody>{data.map((d) => (
          <tr key={d.id}>
            <td className="muted">{d.id}</td>
            <td><Link className="link-plain" to={`/draws/${d.id}`}>{d.title}</Link>{d.autoDraw && <div className="small muted">auto-draw</div>}</td>
            <td><ModeChip mode={d.mode} /></td>
            <td><StatusBadge status={d.status} /></td>
            <td className="num">{d.stats.entries} <span className="muted small">/ {d.stats.participants}p</span></td>
            <td className="num">{money(d.prizeCents)}</td>
            <td className="small">{d.status === 'open' ? <Countdown to={d.closesAt} compact /> : dateTime(d.drawnAt || d.closedAt || d.closesAt)}</td>
            <td>{d.seedCommitment ? <Hash value={d.seedCommitment} n={8} label="commitment" /> : <span className="sealed">at open</span>}{d.seal?.hash && <div className="small muted">seal {d.seal.hash.slice(0, 8)}…</div>}</td>
            <td className="actions">
              {d.status === 'open' && <Button className="btn-ghost btn-xs" loading={busy === `${d.id}:close`} onClick={() => act(d, 'close')}>Close now</Button>}
              {d.status === 'scheduled' && <span className="small muted">opens {dateTime(d.opensAt)}</span>}
              {d.status === 'closed' && d.runRequested && <span className="small muted">awaiting beacon</span>}
              {(d.status === 'open' || d.status === 'closed') && <Button className="btn-gold btn-xs" loading={busy === `${d.id}:run`} onClick={() => act(d, 'run')}>Run draw</Button>}
              {(d.status === 'drawn' || d.status === 'void') && (<><Link className="btn btn-ghost btn-xs" to={`/draws/${d.id}/results`}>Results</Link><a className="btn btn-ghost btn-xs" href={`/api/draws/${d.id}/export.json`} download>JSON</a><a className="btn btn-ghost btn-xs" href={`/api/draws/${d.id}/export.csv`} download>CSV</a><ReportButton drawId={d.id} source="admin" className="btn btn-ghost btn-xs" /></>)}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function CreateTab({ onCreated }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', mode: 'equal', prize: '100', price: '1', duration: '10', cap: '5', autoDraw: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const d = await api('/admin/draws', { method: 'POST', body: { title: f.title, description: f.description, mode: f.mode, prizeCents: Math.round(Number(f.prize) * 100), entryPriceCents: Math.round(Number(f.price) * 100), durationMinutes: Number(f.duration), maxEntriesPerUser: Number(f.cap), autoDraw: f.autoDraw } });
      toast(`Draw #${d.id} opened — seed committed (${d.seedCommitment.slice(0, 10)}…)`, 'success');
      onCreated();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Card className="form-card">
      <form onSubmit={submit} className="form-grid">
        <label className="span-2">Title<input className="input" required minLength={3} maxLength={80} value={f.title} onChange={set('title')} placeholder="e.g. Friday Community Draw" /></label>
        <label className="span-2">Description<textarea className="input" rows={2} value={f.description} onChange={set('description')} placeholder="Shown on the draw page" /></label>
        <label>Mode
          <select className="input" value={f.mode} onChange={set('mode')}>
            <option value="equal">Equal — one entry = one slice</option>
            <option value="weighted">Weighted — slice ∝ tickets per entry</option>
          </select>
        </label>
        <label>Entry cap per person<select className="input" value={f.cap} onChange={set('cap')}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
        <label>Prize (demo $)<input className="input" type="number" min="0" step="0.01" value={f.prize} onChange={set('prize')} /></label>
        <label>{f.mode === 'weighted' ? 'Price per ticket (demo $)' : 'Price per entry (demo $)'}<input className="input" type="number" min="0" step="0.01" value={f.price} onChange={set('price')} /></label>
        <label>Open for (minutes)<input className="input" type="number" min="1" max="100000" value={f.duration} onChange={set('duration')} /></label>
        <label className="check"><input type="checkbox" checked={f.autoDraw} onChange={set('autoDraw')} /> Run the draw automatically at close</label>
        <div className="span-2 note small">On creation the server generates a 256-bit secret seed and publishes only <span className="mono">sha256(seed)</span> (anchored externally). The seed stays server-side until the draw is closed, sealed and run; the final RNG seed also mixes in crowd entropy, a drand beacon and the sealed chain hash.</div>
        <ErrorNote error={err} />
        <div className="span-2"><Button type="submit" loading={busy}>Open draw</Button></div>
      </form>
    </Card>
  );
}

function DrawFilter({ value, onChange }) {
  const { data } = useApi('/admin/draws');
  return (
    <select className="input input-sm filter" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All draws</option>
      {data?.map((d) => <option key={d.id} value={d.id}>#{d.id} {d.title}</option>)}
    </select>
  );
}

function EntriesTab() {
  const [drawId, setDrawId] = useState('');
  const { data, error } = useApi(`/admin/entries${drawId ? `?drawId=${drawId}` : ''}`);
  return (
    <Card className="table-wrap">
      <div className="toolbar"><DrawFilter value={drawId} onChange={setDrawId} /><span className="muted small">{data?.length ?? 0} entries (latest 500)</span></div>
      <ErrorNote error={error} />
      {!data ? <Skeleton h={200} /> : !data.length ? <Empty title="No entries" /> : (
        <table className="table compact">
          <thead><tr><th>Entry</th><th>Draw</th><th>Participant</th><th>Email</th><th className="num">Tickets</th><th>Time</th><th /></tr></thead>
          <tbody>{data.map((e) => (
            <tr key={e.entryId} className={e.won ? 'row-winner' : ''}>
              <td className="mono">#{e.entryId}</td><td>#{e.drawId} {e.drawTitle}</td><td>{e.name}</td><td className="muted small">{e.email}</td>
              <td className="num">{e.tickets}</td><td className="muted small">{dateTime(e.createdAt)}</td><td>{e.won && <span className="winner-mark">Winner</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function LogsTab() {
  const [drawId, setDrawId] = useState('');
  const { data, error } = useApi(`/admin/logs${drawId ? `?drawId=${drawId}` : ''}`, { poll: 5000, deps: [drawId] });
  const { data: draws } = useApi('/admin/draws');
  const [open, setOpen] = useState(null);
  return (
    <div className="stack">
      <Card className="table-wrap">
        <h3 className="card-title">Seeds & commitments</h3>
        <table className="table compact">
          <thead><tr><th>#</th><th>Draw</th><th>Status</th><th>Commitment sha256(seed)</th><th>Seed</th><th /></tr></thead>
          <tbody>{draws?.map((d) => (
            <tr key={d.id}><td className="muted">{d.id}</td><td>{d.title}</td><td><StatusBadge status={d.status} /></td>
              <td><Hash value={d.seedCommitment} n={12} label="commitment" /></td>
              <td>{d.seed ? <Hash value={d.seed} n={12} label="seed" /> : <span className="sealed">🔒 withheld until sealed & drawn</span>}</td>
              <td>{d.seed && <Link className="link small" to={`/verify/${d.id}`}>Verify →</Link>}</td></tr>
          ))}</tbody>
        </table>
      </Card>
      <Card className="table-wrap">
        <div className="toolbar"><h3 className="card-title">Draw log</h3><DrawFilter value={drawId} onChange={setDrawId} /></div>
        <ErrorNote error={error} />
        {!data ? <Skeleton h={200} /> : (
          <table className="table compact logs">
            <thead><tr><th>Time</th><th>Draw</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id} onClick={() => setOpen(open === l.id ? null : l.id)} className="clickable">
                <td className="muted small nowrap">{dateTime(l.createdAt)}</td><td className="small">#{l.drawId} {l.drawTitle}</td>
                <td><span className={`ev ev-${l.event}`}>{l.event.replace(/_/g, ' ')}</span></td><td className="small mono">{l.actor}</td>
                <td>{open === l.id ? <pre className="json">{JSON.stringify(l.details, null, 2)}</pre> : <span className="mono small muted ellipsis">{JSON.stringify(l.details)}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function UsersTab() {
  const { data, error } = useApi('/admin/users');
  return (
    <Card className="table-wrap">
      <ErrorNote error={error} />
      {!data ? <Skeleton h={200} /> : (
        <table className="table">
          <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Referral code</th><th className="num">Entries</th><th className="num">Demo balance</th></tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id}><td className="muted">{u.id}</td><td>{u.name}</td><td className="muted">{u.email}</td><td><span className={`chip ${u.role === 'admin' ? 'chip-gold' : ''}`}>{u.role}</span></td><td className="mono small">{u.referralCode}</td><td className="num">{u.entryCount}</td><td className="num mono">{money(u.balanceCents)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function MailTab() {
  const { data } = useApi('/admin/outbox', { poll: 5000 });
  return (
    <Card className="table-wrap">
      <div className="toolbar"><span className="muted small">Dev outbox — rendered, not delivered (transport: outbox). Files in <span className="mono">server/.data/outbox</span>.</span><Link className="btn btn-ghost btn-sm" to="/outbox">Open outbox viewer</Link></div>
      {!data ? <Skeleton h={200} /> : !data.length ? <Empty title="No mail yet" /> : (
        <table className="table compact">
          <thead><tr><th>Time</th><th>To</th><th>Subject</th><th>Receipt</th><th>Transport</th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.id}><td className="muted small nowrap">{dateTime(m.createdAt)}</td><td className="small">{m.to}</td><td className="small">{m.subject}</td>
              <td>{m.receiptCode && <Link className="link mono small" to={`/verify-receipt?code=${m.receiptCode}`}>{m.receiptCode}</Link>}</td><td><span className="chip">{m.transport}</span></td></tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function AccessRequestsTab() {
  const { data, error } = useApi('/admin/access-requests', { poll: 15000 });
  return (
    <Card className="table-wrap access-requests" data-testid="access-requests">
      <div className="toolbar">
        <div><h2 className="card-title">Access requests {data && <span className="count">{data.length}</span>}</h2>
          <p className="muted small">Submitted from the invite-only landing page. Requests never create accounts — invite approved people with <span className="mono">npm run create-user</span>.</p></div>
      </div>
      <ErrorNote error={error} />
      {!data ? <Skeleton h={160} /> : !data.length ? <Empty title="No access requests yet">New requests from the public landing page appear here.</Empty> : (
        <table className="table table-stack">
          <thead><tr><th>#</th><th>Received</th><th>Name</th><th>Email</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td data-label="#" className="muted">{r.id}</td>
              <td data-label="Received" className="muted small nowrap">{dateTime(r.createdAt)}</td>
              <td data-label="Name"><strong>{r.name}</strong></td>
              <td data-label="Email" className="break"><a className="link" href={`mailto:${r.email}`}>{r.email}</a></td>
              <td data-label="Message" className="small request-msg">{r.message || <span className="muted">—</span>}</td>
              <td data-label="Status"><span className={`chip ${r.status === 'pending' ? 'chip-gold' : ''}`}>{r.status}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}
