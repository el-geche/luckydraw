import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { Button, Card, Skeleton, Tabs, Empty, ErrorNote, ModeChip, Hash } from '../components/ui.jsx';
import { money, dateTime, dateOnly } from '../lib/format.js';

const TX_LABEL = { deposit: 'Deposit', welcome_bonus: 'Welcome credit', entry_fee: 'Entry', prize_payout: 'Prize payout', referral_bonus: 'Referral bonus' };

export default function Dashboard() {
  const { user, ready } = useAuth();
  const { data, error, reload } = useApi(user ? '/me/dashboard' : null, { deps: [user?.id] });
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'entries';
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  if (ready && !user) return <Navigate to="/login?next=/dashboard" replace />;
  if (error) return <Page><ErrorNote error={error} /></Page>;
  if (!data) return <Page><Skeleton h={220} /><div style={{ height: 16 }} /><Skeleton h={320} /></Page>;
  const w = data.wallet;
  const results = data.entries.filter((e) => e.status === 'drawn' || e.status === 'void');
  const wins = results.filter((e) => e.outcome === 'won');

  return (
    <Page className="dash">
      <Rise className="page-head">
        <div><div className="eyebrow">Member dashboard</div><h1>Welcome back, {data.user.name.split(' ')[0]}</h1></div>
        <div className="muted small">Member since {dateOnly(data.user.createdAt)}</div>
      </Rise>

      <div className="dash-top">
        <Rise className="wallet-card card">
          <div className="sim-ribbon">SIMULATED · NO REAL MONEY</div>
          <div className="eyebrow">Demo wallet balance</div>
          <motion.div className="wallet-balance" key={w.balanceCents} initial={{ opacity: 0.4, y: 6 }} animate={{ opacity: 1, y: 0 }}>{money(w.balanceCents)}</motion.div>
          <div className="wallet-sub muted small">Demo credits · provider: <span className="mono">{w.provider}</span></div>
          <DepositForm onDone={reload} />
        </Rise>
        <div className="wallet-totals">
          <Total label="Demo deposits" value={w.totals.depositsCents + w.totals.welcomeCents} hint={`incl. ${money(w.totals.welcomeCents)} welcome credit`} />
          <Total label="Prize payouts" value={w.totals.payoutsCents} hint={`${wins.length} win${wins.length === 1 ? '' : 's'}`} gold />
          <Total label="Referral bonuses" value={w.totals.referralBonusesCents} hint={`${data.referrals.referred.length} referred`} />
          <Total label="Spent on entries" value={-w.totals.entryFeesCents} hint={`${data.entries.reduce((s, e) => s + e.entries, 0)} entries`} />
        </div>
      </div>

      <Rise className="section">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'entries', label: 'Entry history' }, { value: 'results', label: 'Past results' }, { value: 'receipts', label: 'Receipts' }, { value: 'wallet', label: 'Transactions' }, { value: 'referrals', label: 'Referrals' }, { value: 'preferences', label: 'Preferences' }]} />
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
            {tab === 'entries' && <EntriesTable rows={data.entries} />}
            {tab === 'results' && <ResultsList rows={results} />}
            {tab === 'receipts' && <ReceiptsTab />}
            {tab === 'wallet' && <TxTable rows={w.transactions} />}
            {tab === 'preferences' && <PreferencesTab />}
            {tab === 'referrals' && <Referrals r={data.referrals} />}
          </motion.div>
        </AnimatePresence>
      </Rise>
    </Page>
  );
}

function Total({ label, value, hint, gold }) {
  return <Card className="total" hover><span className="muted small">{label}</span><strong className={gold ? 'gold' : ''}>{money(value)}</strong><span className="muted small">{hint}</span></Card>;
}

function DepositForm({ onDone }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState(null);
  const deposit = async (cents) => {
    setBusy(cents); setErr(null);
    try {
      await api('/me/wallet/deposit', { method: 'POST', body: { amountCents: cents } });
      toast(`Simulated deposit of ${money(cents)} added (demo only)`, 'success');
      setCustom('');
      await Promise.all([onDone(), refresh()]);
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  return (
    <div className="deposit">
      <div className="small muted">Add demo funds (simulated card •••• 4242)</div>
      <div className="deposit-row">
        {[2500, 5000, 10000].map((c) => <Button key={c} className="btn-ghost btn-sm" loading={busy === c} onClick={() => deposit(c)}>+ {money(c)}</Button>)}
        <form className="deposit-custom" onSubmit={(e) => { e.preventDefault(); const c = Math.round(Number(custom) * 100); if (c) deposit(c); }}>
          <input className="input input-sm" inputMode="decimal" placeholder="Custom $" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom demo deposit amount" />
          <Button className="btn-gold btn-sm" loading={busy != null && ![2500, 5000, 10000].includes(busy)} type="submit">Add</Button>
        </form>
      </div>
      <ErrorNote error={err} />
    </div>
  );
}

function EntriesTable({ rows }) {
  if (!rows.length) return <Empty title="No entries yet"><Link to="/" className="link">Browse open draws →</Link></Empty>;
  return (
    <Card className="table-wrap">
      <table className="table">
        <thead><tr><th>Draw</th><th>Mode</th><th className="num">Entries</th><th className="num">Tickets</th><th>Entered</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((e) => (
          <tr key={e.drawId}>
            <td><Link className="link-plain" to={`/draws/${e.drawId}`}>{e.title}</Link></td>
            <td><ModeChip mode={e.mode} /></td>
            <td className="num">{e.entries}/5</td><td className="num">{e.tickets}</td>
            <td className="muted small">{dateTime(e.firstEntryAt)}</td>
            <td><Outcome e={e} /></td>
            <td><Link className="link small" to={e.status === 'drawn' ? `/draws/${e.drawId}/results` : `/draws/${e.drawId}`}>{e.status === 'drawn' ? 'Results' : 'View'} →</Link></td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}
const Outcome = ({ e }) => e.outcome === 'won' ? <span className="badge badge-won">Won</span> : e.outcome === 'not_won' ? <span className="badge badge-muted">Not drawn</span> : e.outcome === 'void' ? <span className="badge badge-muted">Void</span> : <span className={`badge badge-${e.status}`}>{e.status === 'open' ? 'Open' : 'Awaiting draw'}</span>;

function ResultsList({ rows }) {
  if (!rows.length) return <Empty title="No completed draws yet">Results appear here once a draw you entered is run.</Empty>;
  return (
    <div className="grid-results">
      {rows.map((e, i) => (
        <motion.div key={e.drawId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
          <Link to={`/draws/${e.drawId}/results`} className={`card result-card${e.outcome === 'won' ? ' won' : ''}`}>
            <div className="row-between"><strong>{e.title}</strong><Outcome e={e} /></div>
            <div className="muted small">Drawn {dateTime(e.drawnAt)} · {e.entries} entr{e.entries === 1 ? 'y' : 'ies'}{e.mode === 'weighted' ? ` · ${e.tickets} tickets` : ''}</div>
            <div className="row-between"><span className="muted small">Prize</span><span className={e.outcome === 'won' ? 'gold' : ''}>{money(e.prizeCents)} {e.outcome === 'won' && '· paid (demo)'}</span></div>
          </Link>
          {e.outcome === 'won' && <WinConsent drawId={e.drawId} />}
        </motion.div>
      ))}
    </div>
  );
}

function TxTable({ rows }) {
  return (
    <Card className="table-wrap">
      <div className="note note-gold small">All transactions below are simulated demo records. No real payments were made or received.</div>
      <table className="table">
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Reference</th><th className="num">Amount</th></tr></thead>
        <tbody>{rows.map((t) => (
          <tr key={t.id}>
            <td className="muted small">{dateTime(t.createdAt)}</td>
            <td><span className={`tx-type tx-${t.type}`}>{TX_LABEL[t.type]}</span></td>
            <td>{t.drawId ? <Link className="link-plain" to={`/draws/${t.drawId}/results`}>{t.description}</Link> : t.description}</td>
            <td className="mono small muted">{t.providerRef || `${t.provider}`}</td>
            <td className={`num mono ${t.amountCents >= 0 ? 'pos' : 'neg'}`}>{money(t.amountCents, { sign: true })}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function Referrals({ r }) {
  const toast = useToast();
  const link = `${location.origin}/register?ref=${r.code}`;
  return (
    <div className="two-col">
      <Card>
        <h3 className="card-title">Your referral code</h3>
        <div className="ref-code mono">{r.code}</div>
        <p className="muted small">When someone registers with your code, you receive a {money(r.bonusPerReferralCents)} demo referral bonus and they receive a {money(1000)} demo welcome bonus. Simulated credits only.</p>
        <Button className="btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(link); toast('Referral link copied', 'success'); }}>Copy referral link</Button>
      </Card>
      <Card>
        <h3 className="card-title">Referred members <span className="count">{r.referred.length}</span></h3>
        {r.referred.length ? <ul className="plain-list">{r.referred.map((x, i) => <li key={i}><span>{x.name}</span><span className="muted small">joined {dateOnly(x.joinedAt)}</span></li>)}</ul> : <p className="muted">No referrals yet.</p>}
      </Card>
    </div>
  );
}

function ReceiptsTab() {
  const { data, error } = useApi('/me/receipts');
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton h={240} />;
  if (!data.length) return <Empty title="No receipts yet">Each time you enter a draw you receive a confirmation receipt, recorded in the draw’s audit chain.</Empty>;
  return (
    <Card className="table-wrap">
      <div className="note small">Every confirmation is an append-only record in the draw’s hash-chained audit trail. Anyone can check a receipt code on the public <Link className="link" to="/verify-receipt">Verify a receipt</Link> page.</div>
      <table className="table compact">
        <thead><tr><th>Receipt code</th><th>Draw</th><th>Entries</th><th>Time</th><th>Chain record</th><th>Delivery</th><th /></tr></thead>
        <tbody>{data.map((r) => (
          <tr key={r.id}>
            <td><Link className="link mono small" to={`/verify-receipt?code=${r.receiptCode}`}>{r.receiptCode}</Link></td>
            <td className="small"><Link className="link-plain" to={`/draws/${r.drawId}`}>#{r.drawId} {r.drawTitle}</Link>{r.sealed && <span className="chip chip-soft" style={{ marginLeft: 6 }}>sealed</span>}</td>
            <td className="mono small">{r.entryIds.map((i) => `#${i}`).join(' ')}</td>
            <td className="muted small nowrap">{dateTime(r.createdAt)}</td>
            <td className="small">#{r.drawSeq} <Hash value={r.recordHash} n={6} /></td>
            <td><span className="chip">{r.deliveryChannel === 'smtp' ? 'SMTP' : 'Demo outbox'}</span></td>
            <td>{r.emailId && <Link className="link small" to={`/outbox?id=${r.emailId}`}>Email →</Link>}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function PreferencesTab() {
  const { data, reload } = useApi('/me/preferences');
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  if (!data) return <Skeleton h={200} />;
  const save = async (key, value) => {
    setBusy(key);
    try { await api('/me/preferences', { method: 'PUT', body: { [key]: value } }); toast('Preferences saved — effective immediately', 'success'); await reload(); }
    catch (e) { toast(e.message, 'danger'); } finally { setBusy(null); }
  };
  const Row = ({ k, label, hint, on, disabled }) => (
    <div className="pref-row">
      <div><strong>{label}</strong><div className="small muted">{hint}</div></div>
      <button type="button" role="switch" aria-checked={on} disabled={disabled || busy === k} className={`switch${on ? ' on' : ''}`} onClick={() => save(k, on)}>
        <motion.span layout className="switch-knob" transition={{ type: 'spring', stiffness: 600, damping: 34 }} />
      </button>
    </div>
  );
  return (
    <div className="two-col">
      <Card>
        <h3 className="card-title">Draw reminders</h3>
        <Row k="remindersOptOut" label="All reminders" hint="A reminder before draws you can still enter close (default 24 hours before)." on={!data.remindersOptOut} />
        <Row k="shortNoticeOptOut" label="Short-notice reminders" hint="An extra reminder a few hours before close, on draws that use it." on={!data.remindersOptOut && !data.shortNoticeOptOut} disabled={data.remindersOptOut} />
        {data.remindersOptOut && <div className="note small">Reminders are off{data.method === 'one_click_link' ? ' (unsubscribed via the one-click email link)' : ''}. Turn them back on at any time.</div>}
        <p className="small muted">Entry confirmations and winner notifications are always sent: they are receipts for your own actions. Every reminder decision, including skipped ones, is logged for the organizer’s audit.</p>
      </Card>
      <Card>
        <h3 className="card-title">Preference history</h3>
        {data.history.length ? <ul className="plain-list">{data.history.map((e) => <li key={e.id}><span>{e.event.replace(/_/g, ' ')}</span><span className="muted small">{e.method.replace(/_/g, ' ')} · {dateTime(e.createdAt)}</span></li>)}</ul> : <p className="muted small">No changes yet.</p>}
      </Card>
    </div>
  );
}

function WinConsent({ drawId }) {
  const { data, reload } = useApi(`/draws/${drawId}/announcement`);
  const toast = useToast();
  if (!data) return null;
  const toggle = async () => {
    try { await api(`/me/wins/${drawId}/consent`, { method: 'POST', body: { showFullName: !data.winnerConsentFullName } }); toast(data.winnerConsentFullName ? 'Your name is masked again' : 'Your full name will be shown on the announcement', 'success'); reload(); }
    catch (e) { toast(e.message, 'danger'); }
  };
  return (
    <div className="win-consent small">
      <span className="muted">Shown publicly as <strong>{data.winnerDisplay}</strong></span>
      <button className="link small" onClick={toggle}>{data.winnerConsentFullName ? 'Mask my name' : 'Show my full name'}</button>
      <Link className="link small" to={`/draws/${drawId}/winner`}>Announcement →</Link>
    </div>
  );
}
