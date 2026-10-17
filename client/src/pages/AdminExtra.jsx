import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useApi } from '../lib/useApi.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Button, Card, Hash, ModeChip, StatusBadge, Skeleton, ErrorNote, Empty } from '../components/ui.jsx';
import { AnchorBadge } from '../components/Fairness.jsx';
import { money, dateTime, utcTime } from '../lib/format.js';
import { downloadAuthed, fetchAuthedText } from '../lib/download.js';

const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
function useDraws() { return useApi('/admin/draws').data ?? []; }
function useUsers() { return useApi('/admin/users').data ?? []; }

function ExportButtons({ path, name, filters }) {
  const toast = useToast();
  const go = async (fmt) => {
    try { const h = await downloadAuthed(`${path}.${fmt}${qs(filters)}`, `${name}.${fmt}`); toast(`Exported ${fmt.toUpperCase()} · sha256 ${h?.slice(0, 12)}…`, 'success'); }
    catch (e) { toast(e.message, 'danger'); }
  };
  return <div className="row-gap"><Button className="btn-ghost btn-sm" onClick={() => go('csv')}>↓ CSV</Button><Button className="btn-ghost btn-sm" onClick={() => go('json')}>↓ JSON</Button></div>;
}

/* ---------------- Entry audit trail ---------------- */
export function TrailTab() {
  const draws = useDraws(); const users = useUsers();
  const [f, setF] = useState({ drawId: '', userId: '', from: '', to: '', q: '' });
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 300); return () => clearTimeout(t); }, [q]);
  const filters = { ...f, from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : '' };
  const { data, error } = useApi(`/admin/ledger${qs(filters)}`, { deps: [JSON.stringify(filters)] });
  const [verify, setVerify] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState(null);
  const runVerify = async () => { setBusy(true); try { setVerify(await api('/admin/ledger/verify')); } finally { setBusy(false); } };
  const openMail = async (id) => { try { setMail(await api(`/admin/ledger/${id}/email`)); } catch (e) { setMail({ error: e.message }); } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="stack">
      <Card>
        <div className="row-between">
          <div><h3 className="card-title">Entry audit trail</h3><p className="small muted">Every entry confirmation is an append-only, hash-chained record (one chain per draw). Updates and deletes are refused by the database.</p></div>
          <div className="row-gap"><Button className="btn-gold btn-sm" loading={busy} onClick={runVerify}>Verify chain</Button><ExportButtons path="/admin/ledger/export" name="luckydraw-entry-audit-trail" filters={filters} /></div>
        </div>
        <AnimatePresence>{verify && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }}>
            <div className={`verdict ${verify.ok ? 'ok' : 'fail'}`}><span className="verdict-icon">{verify.ok ? '✓' : '✕'}</span><div><strong>{verify.ok ? `All ${verify.draws.length} chains intact` : 'Chain problem detected'}</strong><div className="small muted">{verify.totalRecords} records · recomputed server-side including private identity fields</div></div></div>
            <div className="chain-heads">{verify.draws.map((d) => <span key={d.drawId} className={`chip ${d.ok ? 'chip-ok' : 'chip-bad'}`}>#{d.drawId} · {d.count} · {d.sealed ? (d.sealMatch ? 'seal ✓' : 'seal ✕') : 'open'}</span>)}</div>
          </motion.div>
        )}</AnimatePresence>
      </Card>
      <Card className="table-wrap">
        <div className="toolbar wrap">
          <select className="input input-sm filter" value={f.drawId} onChange={set('drawId')}><option value="">All draws</option>{draws.map((d) => <option key={d.id} value={d.id}>#{d.id} {d.title}</option>)}</select>
          <select className="input input-sm filter" value={f.userId} onChange={set('userId')}><option value="">All members</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <label className="small muted">From <input type="date" className="input input-sm" value={f.from} onChange={set('from')} /></label>
          <label className="small muted">To <input type="date" className="input input-sm" value={f.to} onChange={set('to')} /></label>
          <input className="input input-sm input-search" placeholder="Receipt code…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">{data?.length ?? 0} records</span>
        </div>
        <ErrorNote error={error} />
        {!data ? <Skeleton h={240} /> : !data.length ? <Empty title="No records match" /> : (
          <table className="table compact">
            <thead><tr><th>Time (UTC)</th><th>Draw · seq</th><th>Member</th><th>Entries</th><th>Receipt</th><th>Delivery</th><th>prev → hash</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}>
                <td className="mono small nowrap">{utcTime(r.createdAt).replace(' UTC', '')}</td>
                <td className="small">#{r.drawId} · {r.drawSeq}</td>
                <td className="small">{r.userName}<div className="muted">{r.userEmail}</div></td>
                <td className="mono small">{r.entryIds.map((i) => `#${i}`).join(' ')}</td>
                <td className="mono small">{r.receiptCode}</td>
                <td><span className="chip">{r.deliveryChannel}</span></td>
                <td className="mono small muted nowrap">{r.prevHash.slice(0, 6)}→<span className="gold">{r.recordHash.slice(0, 8)}</span></td>
                <td><button className="link small" onClick={() => openMail(r.id)}>Email</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <AnimatePresence>{mail && (
        <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMail(null)}>
          <motion.div className="modal card" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="row-between"><strong>{mail.subject ?? 'Rendered email'}</strong><button className="btn btn-ghost btn-xs" onClick={() => setMail(null)}>Close</button></div>
            {mail.error ? <div className="note note-danger">{mail.error}</div> : <iframe title="Rendered email" className="mail-frame" sandbox="" srcDoc={mail.html} />}
          </motion.div>
        </motion.div>
      )}</AnimatePresence>
    </div>
  );
}

/* ---------------- Anchors ---------------- */
export function AnchorsTab() {
  const { data, reload } = useApi('/admin/anchors', { poll: 10000 });
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const act = async (k, path) => { setBusy(k); try { const r = await api(path, { method: 'POST' }); toast(k === 'up' ? `Checked ${r.checked} proofs · ${r.upgraded} upgraded to Bitcoin` : 'Pending anchors retried', 'success'); reload(); } catch (e) { toast(e.message, 'danger'); } finally { setBusy(null); } };
  return (
    <Card className="table-wrap">
      <div className="toolbar"><span className="small muted">Seed commitments are anchored at open; sealed chain hashes at close. Only hashes leave the server.</span>
        <div className="row-gap"><Button className="btn-ghost btn-sm" loading={busy === 'retry'} onClick={() => act('retry', '/admin/anchors/process')}>Retry pending</Button><Button className="btn-gold btn-sm" loading={busy === 'up'} onClick={() => act('up', '/admin/anchors/upgrade')}>Upgrade OTS proofs</Button></div></div>
      {!data ? <Skeleton h={200} /> : !data.length ? <Empty title="No anchors" /> : (
        <table className="table compact">
          <thead><tr><th>Draw</th><th>Kind</th><th>Provider</th><th>Status</th><th>Digest</th><th className="num">Attempts</th><th>Submitted</th><th>Last error</th></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a.id}><td className="small">#{a.draw_id} {a.title}</td><td><span className="chip">{a.kind}</span></td><td className="small">{a.provider}</td><td><AnchorBadge status={a.status} />{a.info?.bitcoinBlock && <div className="small gold">block {a.info.bitcoinBlock}</div>}</td>
              <td><Hash value={a.digest} n={8} /></td><td className="num">{a.attempts}</td><td className="small muted">{dateTime(a.submitted_at)}</td><td className="small muted ellipsis">{a.last_error}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

/* ---------------- Reminder log ---------------- */
const OUTCOMES = ['sent', 'skipped_at_cap', 'skipped_draw_closed', 'skipped_opted_out', 'skipped_unsubscribed', 'failed'];
export function RemindersTab() {
  const draws = useDraws(); const users = useUsers();
  const toast = useToast();
  const [f, setF] = useState({ drawId: '', userId: '', type: '', outcome: '', from: '', to: '' });
  const filters = { ...f, from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : '' };
  const { data, reload } = useApi(`/admin/reminders${qs(filters)}`, { deps: [JSON.stringify(filters)], poll: 15000 });
  const { data: prefs } = useApi('/admin/preference-events');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const run = async () => { try { const r = await api('/admin/reminders/run', { method: 'POST' }); toast(`${r.length} new reminder decisions`, 'success'); reload(); } catch (e) { toast(e.message, 'danger'); } };
  return (
    <div className="stack">
      <div className="summary-grid">
        {OUTCOMES.map((o, i) => (
          <motion.button key={o} className={`card summary-card out-${o}${f.outcome === o ? ' active' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }} onClick={() => setF({ ...f, outcome: f.outcome === o ? '' : o })}>
            <strong>{data?.summary?.[o] ?? 0}</strong><span className="small muted">{o.replace(/_/g, ' ')}</span>
          </motion.button>
        ))}
      </div>
      <Card className="table-wrap">
        <div className="toolbar wrap">
          <select className="input input-sm filter" value={f.drawId} onChange={set('drawId')}><option value="">All draws</option>{draws.map((d) => <option key={d.id} value={d.id}>#{d.id} {d.title}</option>)}</select>
          <select className="input input-sm filter" value={f.userId} onChange={set('userId')}><option value="">All members</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select className="input input-sm filter" value={f.type} onChange={set('type')}><option value="">All types</option><option value="24h">24h</option><option value="short_notice">Short-notice</option></select>
          <select className="input input-sm filter" value={f.outcome} onChange={set('outcome')}><option value="">All outcomes</option>{OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          <label className="small muted">From <input type="date" className="input input-sm" value={f.from} onChange={set('from')} /></label>
          <label className="small muted">To <input type="date" className="input input-sm" value={f.to} onChange={set('to')} /></label>
          <Button className="btn-ghost btn-sm" onClick={run}>Run reminder pass</Button>
          <ExportButtons path="/admin/reminders/export" name="luckydraw-reminder-log" filters={filters} />
        </div>
        {!data ? <Skeleton h={220} /> : !data.rows.length ? <Empty title="No reminder decisions match" /> : (
          <table className="table compact">
            <thead><tr><th>UTC</th><th>Organizer local ({data.organizerTimezone})</th><th>Draw</th><th>Member</th><th>Type</th><th>Outcome</th><th>Channel</th><th /></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id}><td className="mono small nowrap">{utcTime(r.createdAt).replace(' UTC', '')}</td><td className="small nowrap">{r.createdAtOrganizer}</td><td className="small">#{r.drawId} {r.drawTitle}</td><td className="small">{r.member}</td>
                <td><span className="chip">{r.type === '24h' ? '24h' : 'short-notice'}</span></td><td><span className={`out-chip out-${r.outcome}`}>{r.outcome.replace(/_/g, ' ')}</span></td>
                <td className="small">{r.channel ?? '—'}</td><td>{r.emailId && <Link className="link small" to={`/outbox?id=${r.emailId}`}>Email →</Link>}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <Card className="table-wrap">
        <div className="toolbar"><h3 className="card-title">Unsubscribe & opt-out events</h3><ExportButtons path="/admin/preference-events/export" name="luckydraw-preference-events" filters={{}} /></div>
        {!prefs ? <Skeleton h={120} /> : !prefs.length ? <Empty title="No preference changes" /> : (
          <table className="table compact"><thead><tr><th>Time</th><th>Member</th><th>Event</th><th>Method</th></tr></thead>
            <tbody>{prefs.map((e) => <tr key={e.id}><td className="small muted">{dateTime(e.createdAt)}</td><td className="small">{e.member}</td><td className="small">{e.event.replace(/_/g, ' ')}</td><td><span className="chip">{e.method === 'one_click_link' ? 'one-click link' : e.method.replace(/_/g, ' ')}</span></td></tr>)}</tbody></table>
        )}
        <p className="small muted">Privacy: reminders contain no tracking pixel. Open tracking exists only for winner notifications, only when SMTP is configured <em>and</em> <span className="mono">MAIL_OPEN_TRACKING=true</span>; opens are approximate and no raw IP addresses are stored.</p>
      </Card>
    </div>
  );
}

/* ---------------- Winner announcements ---------------- */
export function WinnersTab() {
  const { data: draws, reload } = useApi('/admin/draws');
  const { data: ev, reload: reloadEv } = useApi('/admin/announcement-events', { poll: 15000 });
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const drawn = (draws ?? []).filter((d) => d.status === 'drawn');
  const setVis = async (d, v) => { try { await api(`/admin/draws/${d.id}/visibility`, { method: 'POST', body: { visibility: v } }); toast(`Draw #${d.id} announcement: ${v}`, 'success'); reload(); reloadEv(); } catch (e) { toast(e.message, 'danger'); } };
  const resend = async (d) => { setBusy(d.id); try { await api(`/admin/draws/${d.id}/notify-winner`, { method: 'POST' }); toast('Winner notification re-sent to the demo outbox (PDF attached)', 'success'); reloadEv(); } catch (e) { toast(e.message, 'danger'); } finally { setBusy(null); } };
  return (
    <div className="stack">
      <Card className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Draw</th><th>Winner</th><th>Visibility</th><th>Notification</th><th /></tr></thead>
          <tbody>{drawn.map((d) => {
            const sent = ev?.rows.filter((e) => e.drawId === d.id && /winner_email_(delivered|accepted)/.test(e.event)).length ?? 0;
            const opened = ev?.rows.some((e) => e.drawId === d.id && /opened/.test(e.event));
            return (
              <tr key={d.id}><td className="small">#{d.id} {d.title}</td><td className="small">{d.winner?.name}</td>
                <td><select className="input input-sm" value={d.announcementVisibility} onChange={(e) => setVis(d, e.target.value)}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="organizer">Organizer only</option></select></td>
                <td className="small">{sent ? `${sent} sent` : 'not sent'}{opened && <span className="chip chip-soft" style={{ marginLeft: 6 }}>opened (approx.)</span>}</td>
                <td className="actions"><Link className="btn btn-ghost btn-xs" to={`/draws/${d.id}/winner`}>View</Link><Button className="btn-ghost btn-xs" loading={busy === d.id} onClick={() => resend(d)}>Resend (demo)</Button></td></tr>
            );
          })}</tbody>
        </table>
      </Card>
      <Card className="table-wrap">
        <div className="toolbar"><h3 className="card-title">Announcement & notification log</h3><ExportButtons path="/admin/announcement-events/export" name="luckydraw-announcement-log" filters={{}} /></div>
        {!ev ? <Skeleton h={160} /> : (
          <table className="table compact"><thead><tr><th>Time</th><th>Draw</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead>
            <tbody>{ev.rows.slice(0, 200).map((e) => <tr key={e.id}><td className="small muted nowrap">{dateTime(e.createdAt)}</td><td className="small">#{e.drawId}</td><td><span className="ev">{e.event.replace(/_/g, ' ')}</span></td><td className="mono small">{e.actor}</td><td className="mono small muted ellipsis">{JSON.stringify(e.details)}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Calendar & schedules ---------------- */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function CalendarTab() {
  const { data: cal, reload: reloadCal } = useApi('/admin/calendar', { poll: 20000 });
  const { data: schedules, reload } = useApi('/admin/schedules');
  const toast = useToast();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [showForm, setShowForm] = useState(false);
  const items = useMemo(() => [
    ...(cal?.draws ?? []).map((d) => ({ key: `d${d.id}`, at: new Date(d.closesAt), title: d.title, status: d.status, id: d.id, prize: d.prizeCents })),
    ...(cal?.projected ?? []).map((p, i) => ({ key: `p${i}`, at: new Date(p.closesAt), title: p.title, status: 'projected', prize: p.prizeCents })),
  ], [cal]);
  const days = useMemo(() => {
    const start = new Date(month); start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const act = async (s, what) => {
    try {
      if (what === 'delete') await api(`/admin/schedules/${s.id}`, { method: 'DELETE' });
      else await api(`/admin/schedules/${s.id}/${what}`, { method: 'POST' });
      toast(`Schedule ${what === 'delete' ? 'deleted' : what === 'pause' ? 'paused' : 'resumed'}`, 'success'); reload(); reloadCal();
    } catch (e) { toast(e.message, 'danger'); }
  };
  return (
    <div className="stack">
      <Card>
        <div className="row-between cal-head">
          <Button className="btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</Button>
          <h3 className="card-title">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
          <Button className="btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</Button>
        </div>
        <div className="cal-grid">
          {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {days.map((day) => {
            const its = items.filter((x) => same(x.at, day));
            return (
              <div key={day.toISOString()} className={`cal-cell${day.getMonth() !== month.getMonth() ? ' out' : ''}${same(day, new Date()) ? ' today' : ''}`}>
                <span className="cal-n">{day.getDate()}</span>
                {its.map((x) => (
                  <motion.div key={x.key} className={`cal-item st-${x.status}`} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} title={`${x.title} · closes ${x.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}>
                    {x.id ? <Link to={`/draws/${x.id}`}>{x.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {x.title}</Link> : <span>{x.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {x.title}</span>}
                  </motion.div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="cal-legend small muted"><span className="cal-item st-open">open</span><span className="cal-item st-scheduled">scheduled (created)</span><span className="cal-item st-projected">projected</span><span className="cal-item st-drawn">drawn</span> · entries shown on their close date, in your local time</div>
      </Card>
      <Card className="table-wrap">
        <div className="toolbar"><h3 className="card-title">Recurring schedules</h3><Button className="btn-gold btn-sm" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New schedule'}</Button></div>
        <AnimatePresence>{showForm && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}><ScheduleForm onDone={() => { setShowForm(false); reload(); reloadCal(); }} /></motion.div>}</AnimatePresence>
        {!schedules ? <Skeleton h={120} /> : !schedules.length ? <Empty title="No schedules" /> : (
          <table className="table compact">
            <thead><tr><th>Name</th><th>Rule</th><th>Time zone</th><th>Window</th><th>Prize</th><th>Mode · cap</th><th>Visibility</th><th>Status</th><th /></tr></thead>
            <tbody>{schedules.map((s) => (
              <tr key={s.id}><td><strong className="small">{s.name}</strong><div className="small muted">{s.titleTemplate}</div></td><td className="mono small">{s.cron}</td><td className="small">{s.timezone}</td>
                <td className="small">{s.windowMinutes >= 1440 ? `${(s.windowMinutes / 1440).toFixed(1)} d` : `${s.windowMinutes} min`}</td><td className="small">{money(s.prizeCents)}</td><td><ModeChip mode={s.mode} /> <span className="small">{s.maxEntriesPerUser}</span></td>
                <td className="small">{s.announcementVisibility}</td><td>{s.paused ? <span className="badge badge-muted">paused</span> : <span className="badge badge-open">active</span>}</td>
                <td className="actions">{s.paused ? <Button className="btn-ghost btn-xs" onClick={() => act(s, 'resume')}>Resume</Button> : <Button className="btn-ghost btn-xs" onClick={() => act(s, 'pause')}>Pause</Button>}<Button className="btn-danger btn-xs" onClick={() => act(s, 'delete')}>Delete</Button></td></tr>
            ))}</tbody>
          </table>
        )}
        <p className="small muted">The scheduler creates each occurrence ahead of time (within the schedule's horizon) with a fresh secret seed, publishes the commitment when the entry window opens, then closes, seals, anchors and draws it automatically — the same fairness stack as manual draws.</p>
      </Card>
    </div>
  );
}

function ScheduleForm({ onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', titleTemplate: '{name} — {date}', freq: 'weekly', days: [5], monthDay: 1, time: '20:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, windowHours: 72, prize: 250, price: 2, cap: 5, mode: 'equal', vis: 'public', reminderHours: 24, shortNotice: 3 });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const rule = f.freq === 'weekly' ? { freq: 'weekly', byWeekday: f.days, time: f.time } : f.freq === 'monthly' ? { freq: 'monthly', byMonthDay: [Number(f.monthDay)], time: f.time } : { freq: 'daily', time: f.time };
    try {
      await api('/admin/schedules', { method: 'POST', body: { name: f.name, titleTemplate: f.titleTemplate.replace('{name}', f.name), mode: f.mode, prizeCents: Math.round(f.prize * 100), entryPriceCents: Math.round(f.price * 100), maxEntriesPerUser: Number(f.cap), announcementVisibility: f.vis, rule, timezone: f.timezone, windowMinutes: Math.round(f.windowHours * 60), reminderHours: Number(f.reminderHours), shortNoticeHours: Number(f.shortNotice) || null, horizonDays: 14 } });
      toast('Schedule created — upcoming occurrences materialised', 'success'); onDone();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <form className="form-grid schedule-form" onSubmit={submit}>
      <label>Name<input className="input" required minLength={3} value={f.name} onChange={set('name')} placeholder="e.g. Sunday Brunch Draw" /></label>
      <label>Title template<input className="input" value={f.titleTemplate} onChange={set('titleTemplate')} /></label>
      <label>Repeats<select className="input" value={f.freq} onChange={set('freq')}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
      {f.freq === 'weekly' && <div className="label-like">Days<div className="day-pick">{DOW.map((d, i) => <button type="button" key={d} className={`seg-btn${f.days.includes(i) ? ' active' : ''}`} onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })}><span>{d}</span></button>)}</div></div>}
      {f.freq === 'monthly' && <label>Day of month<input className="input" type="number" min="1" max="28" value={f.monthDay} onChange={set('monthDay')} /></label>}
      <label>Close time<input className="input" type="time" value={f.time} onChange={set('time')} /></label>
      <label>Time zone<input className="input" value={f.timezone} onChange={set('timezone')} /></label>
      <label>Entry window (hours before close)<input className="input" type="number" min="0.1" step="0.5" value={f.windowHours} onChange={set('windowHours')} /></label>
      <label>Prize (demo $)<input className="input" type="number" min="0" value={f.prize} onChange={set('prize')} /></label>
      <label>Entry price (demo $)<input className="input" type="number" min="0" step="0.5" value={f.price} onChange={set('price')} /></label>
      <label>Mode<select className="input" value={f.mode} onChange={set('mode')}><option value="equal">Equal</option><option value="weighted">Weighted</option></select></label>
      <label>Cap per person<select className="input" value={f.cap} onChange={set('cap')}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
      <label>Announcement<select className="input" value={f.vis} onChange={set('vis')}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="organizer">Organizer only</option></select></label>
      <label>Reminder (hours before)<input className="input" type="number" min="1" value={f.reminderHours} onChange={set('reminderHours')} /></label>
      <label>Short-notice (hours, blank = off)<input className="input" type="number" min="0" value={f.shortNotice} onChange={set('shortNotice')} /></label>
      <ErrorNote error={err} />
      <div className="span-2"><Button type="submit" loading={busy}>Create schedule</Button></div>
    </form>
  );
}

/* ---------------- Compliance ---------------- */
export function ComplianceTab() {
  const [html, setHtml] = useState(null);
  const [err, setErr] = useState(null);
  const toast = useToast();
  useEffect(() => { fetchAuthedText('/admin/compliance.html').then(setHtml).catch(setErr); }, []);
  const pdf = async () => { try { await downloadAuthed('/admin/compliance.pdf', 'luckydraw-compliance-summary.pdf'); } catch (e) { toast(e.message, 'danger'); } };
  return (
    <Card>
      <div className="row-between">
        <div><h3 className="card-title">Compliance summary</h3><p className="small muted">One-page plain-language summary for regulators and sponsors, with live platform statistics. Describes technical mechanisms only — not legal advice or a certification.</p></div>
        <Button className="btn-gold btn-sm" onClick={pdf}>↓ Download PDF</Button>
      </div>
      <ErrorNote error={err} />
      {!html ? <Skeleton h={600} /> : <iframe title="Compliance summary preview" className="compliance-frame" sandbox="" srcDoc={html} />}
    </Card>
  );
}
