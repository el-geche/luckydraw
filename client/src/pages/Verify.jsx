import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { verifyAudit, ALGORITHM } from '@luckydraw/shared';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { api } from '../lib/api.js';
import { sha256 } from '../lib/sha256.js';
import { DrawWheel } from '../components/DrawWheel.jsx';
import { Button, Card, Tabs, ErrorNote } from '../components/ui.jsx';
import { pct } from '../lib/format.js';

export default function Verify() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: draws } = useApi('/draws?status=drawn');
  const [source, setSource] = useState('published');
  const [json, setJson] = useState('');
  const [state, setState] = useState(null); // { audit, verification }
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const wheel = useRef(null);

  const run = async (audit) => {
    setBusy(true); setErr(null); setState(null);
    try {
      const verification = await verifyAudit(audit, { sha256 });
      setState({ audit, verification });
      setTimeout(() => wheel.current?.spin(), 350);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const loadPublished = async (drawId) => {
    try {
      const audit = await api(`/draws/${drawId}/audit`);
      setJson(JSON.stringify(audit, null, 2));
      await run(audit);
    } catch (e) { setErr(e); }
  };
  useEffect(() => { if (id) loadPublished(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runPasted = () => {
    try { run(JSON.parse(json)); } catch (e) { setErr(new Error(`Invalid JSON: ${e.message}`)); }
  };
  const v = state?.verification;
  return (
    <Page className="verify">
      <Rise className="page-head">
        <div>
          <div className="eyebrow">Public verification</div>
          <h1>Re-run any draw in your browser</h1>
          <p className="lead small-lead">This page imports the exact same <span className="mono">@luckydraw/shared</span> draw engine the server uses. Nothing is sent to the server — the seed check, entry-hash check and winner recomputation all run locally.</p>
        </div>
      </Rise>

      <div className="verify-grid">
        <Rise><Card>
          <Tabs value={source} onChange={setSource} tabs={[{ value: 'published', label: 'Published draw' }, { value: 'paste', label: 'Paste seed + entries' }]} />
          {source === 'published' ? (
            <div className="stack">
              <label className="field-label">Choose a completed draw</label>
              <select className="input" value={id || ''} onChange={(e) => nav(`/verify/${e.target.value}`)}>
                <option value="" disabled>Select a draw…</option>
                {draws?.map((d) => <option key={d.id} value={d.id}>#{d.id} — {d.title} ({d.mode})</option>)}
              </select>
              <p className="muted small">Opens the draw’s public verification page: one-click check of the audit chain, sealed hash, anchors, seed derivation and winner.</p>
              {id && <Button className="btn-ghost" onClick={() => loadPublished(id)} loading={busy}>Re-run verification</Button>}
            </div>
          ) : (
            <div className="stack">
              <label className="field-label">Audit JSON <span className="muted">— needs seed, mode, entries; optional commitment, entriesHash, winnerEntryId</span></label>
              <textarea className="input mono json-input" rows={14} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false}
                placeholder={`{\n  "algorithm": "${ALGORITHM}",\n  "mode": "equal",\n  "seed": "…",\n  "commitment": "…",\n  "entries": [{ "entryId": 1, "userId": 2, "name": "Ava M.", "tickets": 1 }],\n  "winnerEntryId": 1\n}`} />
              <div className="row-gap">
                <Button onClick={runPasted} loading={busy} disabled={!json.trim()}>Run verification</Button>
                <Button className="btn-ghost" onClick={() => setJson(JSON.stringify({ algorithm: ALGORITHM, mode: 'weighted', seed: 'my-own-test-seed', entries: [{ entryId: 1, userId: 1, name: 'Alice', tickets: 2 }, { entryId: 2, userId: 2, name: 'Bob', tickets: 5 }, { entryId: 3, userId: 3, name: 'Cara', tickets: 3 }] }, null, 2))}>Load example</Button>
                <span className="muted small">Tip: edit one ticket count or one seed character and watch the checks fail.</span>
              </div>
            </div>
          )}
          <ErrorNote error={err} />
        </Card></Rise>

        <Rise><Card className="verify-result">
          <AnimatePresence mode="wait">
            {!v ? (
              <motion.div key="empty" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="empty-title">No verification run yet</div><div className="muted">Pick a published draw or paste an audit record.</div>
              </motion.div>
            ) : (
              <motion.div key={state.audit.seed + state.audit.entries.length + JSON.stringify(state.audit.entries).length} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className={`verdict ${v.ok ? 'ok' : 'fail'}`}>
                  <span className="verdict-icon">{v.ok ? '✓' : '✕'}</span>
                  <div><strong>{v.ok ? (v.checks.length ? 'Verified — the result is reproducible' : 'Computed (nothing to compare against)') : 'Mismatch — this record does not verify'}</strong>
                    <div className="small muted">{v.checks.filter((c) => c.ok).length}/{v.checks.length} checks passed · computed locally in your browser</div></div>
                </div>
                <ul className="checks">
                  {v.checks.map((c, i) => (
                    <motion.li key={c.name} className={c.ok ? 'ok' : 'fail'} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.12 }}>
                      <span className="check-icon">{c.ok ? '✓' : '✕'}</span>
                      <div><div>{c.name}</div><div className="mono small muted break">expected {String(c.expected)}<br />computed {String(c.actual)}</div></div>
                    </motion.li>
                  ))}
                </ul>
                <div className="recompute">
                  <div className="verify-wheel"><DrawWheel ref={wheel} size={260} spinDuration={4.5} slices={v.result.slices} totalWeight={v.result.totalWeight} result={{ ticket: v.result.ticket, totalWeight: v.result.totalWeight, winnerEntryId: v.result.winner.entryId }} /></div>
                  <dl className="kv">
                    <dt>rng = seedrandom(seed)</dt><dd className="mono">u = {v.result.u}</dd>
                    <dt>Total weight W</dt><dd className="mono">{v.result.totalWeight}</dd>
                    <dt>ticket = floor(u × W)</dt><dd className="mono">{v.result.ticket}</dd>
                    <dt>Winning entry</dt><dd><strong className="gold">#{v.result.winner.entryId} · {v.result.winner.name}</strong></dd>
                    <dt>Their odds</dt><dd className="mono">{pct(v.result.odds.find((o) => o.userId === v.result.winner.userId).probability, 2)}</dd>
                  </dl>
                </div>
                {state.audit.drawId && <Link className="link" to={`/draws/${state.audit.drawId}/results`}>Open official results →</Link>}
              </motion.div>
            )}
          </AnimatePresence>
        </Card></Rise>
      </div>
    </Page>
  );
}
