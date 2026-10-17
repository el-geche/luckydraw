import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { verifyBundle, verifyDrawChain, sha256Hex, crowdEntropyInput, SEED_DERIVATION } from '@luckydraw/shared';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { api } from '../lib/api.js';
import { DrawWheel } from '../components/DrawWheel.jsx';
import { Button, Card, Hash, ModeChip, StatusBadge, Skeleton, ErrorNote } from '../components/ui.jsx';
import { SealPanel, AnchorList, ReportButton } from '../components/Fairness.jsx';
import { dateTime } from '../lib/format.js';
import { downloadJson } from '../lib/download.js';

const ICON = { pass: '✓', fail: '✕', pending: '◷', skip: '–', running: '' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function VerifyDraw() {
  const { id } = useParams();
  const { data: d, error } = useApi(`/draws/${id}`);
  const [run, setRun] = useState(null); // { steps, shown, verdict, derived, result, bundle }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const wheel = useRef(null);
  const drawn = d?.status === 'drawn';
  const sealed = Boolean(d?.seal?.hash);

  useEffect(() => { setRun(null); }, [id]);

  const verify = async () => {
    setBusy(true); setErr(null); setRun(null);
    try {
      let out;
      if (drawn) {
        const bundle = await api(`/draws/${id}/verification-bundle`);
        out = { ...(await verifyBundle(bundle)), bundle };
      } else {
        const chain = await api(`/draws/${id}/chain.json`);
        const cv = await verifyDrawChain({ drawId: chain.drawId, seedCommitment: chain.seedCommitment, records: chain.records, seal: chain.seal }, { sha256: async (s) => sha256Hex(s) });
        const steps = [
          { key: 'chain', label: `Audit chain recomputed (${cv.count} records)`, status: cv.problems.some((p) => p.drawSeq != null) ? 'fail' : 'pass', expected: 'linked records', actual: cv.problems[0]?.problem ?? `${cv.count} linked records` },
          { key: 'seal', label: 'Sealed final hash matches recomputed chain', status: cv.sealMatch ? 'pass' : 'fail', expected: `${chain.seal.hash} (${chain.seal.count})`, actual: `${cv.finalHash} (${cv.count})` },
          { key: 'seed', label: 'Seed reveal, crowd entropy and winner', status: 'pending', expected: 'published after the draw runs', actual: d.entropy?.availableAt ? `waiting for drand round ${d.entropy.round} (${dateTime(d.entropy.availableAt)})` : 'waiting for the draw to run' },
        ];
        out = { steps, verdict: steps.some((s) => s.status === 'fail') ? 'fail' : 'pending', derived: { chainFinalHash: cv.finalHash }, bundle: { chain } };
      }
      // Reveal steps one by one.
      setRun({ ...out, shown: 0 });
      for (let i = 1; i <= out.steps.length; i++) { await sleep(380); setRun((r) => r && { ...r, shown: i }); }
      if (out.result) setTimeout(() => wheel.current?.spin(), 300);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  if (error) return <Page><ErrorNote error={error} /></Page>;
  if (!d) return <Page><Skeleton h={480} /></Page>;
  const done = run && run.shown >= run.steps.length;
  const audit = run?.bundle?.audit;

  return (
    <Page className="verify-draw">
      <Rise className="draw-head">
        <div>
          <div className="crumbs"><Link to="/verify">Verify</Link><span>/</span><span>Draw #{d.id}</span></div>
          <h1>Verify this draw</h1>
          <div className="head-meta"><strong>{d.title}</strong><StatusBadge status={d.status} /><ModeChip mode={d.mode} /></div>
          <p className="lead small-lead">Everything below is recomputed locally in your browser with the same <span className="mono">@luckydraw/shared</span> code the server runs. No login, and nothing you compute here is sent back.</p>
        </div>
        <div className="head-actions">
          <ReportButton drawId={d.id} source="verify" />
          {(drawn || d.status === 'void') && <Link to={`/draws/${d.id}/results`} className="btn btn-ghost btn-sm">Results</Link>}
        </div>
      </Rise>

      {!sealed ? (
        <Card><h2>Not sealed yet</h2><p className="muted">This draw is {d.status}. Only the seed commitment is public until the draw closes; at close the audit chain is sealed and its final hash is anchored externally.</p><SealPanel d={d} compact /></Card>
      ) : (
        <>
          <Rise><Card className="oneclick">
            <div className="oneclick-head">
              <div>
                <h2>One-click verification</h2>
                <p className="muted small">{drawn ? 'Runs all eight checks: audit chain → sealed hash → external anchor → seed commitment → crowd entropy → public random → final seed → winner.' : 'The draw is sealed but has not run yet. You can already recompute the chain and confirm the sealed hash.'}</p>
              </div>
              <Button className="btn-gold btn-lg" onClick={verify} loading={busy}>{run ? 'Run again' : 'Verify this draw'}</Button>
            </div>
            <ErrorNote error={err} />
            <AnimatePresence>
              {run && (
                <motion.div key="steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }}>
                  <ol className="vsteps">
                    {run.steps.map((s, i) => {
                      const st = i < run.shown ? s.status : i === run.shown ? 'running' : 'waiting';
                      return (
                        <motion.li key={s.key} className={`vstep ${st}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: st === 'waiting' ? 0.35 : 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                          <span className="vstep-icon">{st === 'running' ? <span className="spinner" /> : ICON[st] ?? i + 1}</span>
                          <div className="vstep-body">
                            <div className="vstep-label">{s.label}</div>
                            {i < run.shown && s.status !== 'pass' && <div className="mono small muted break">expected {String(s.expected)}<br />computed {String(s.actual)}</div>}
                          </div>
                          {i < run.shown && <span className={`vstep-tag ${s.status}`}>{s.status === 'pass' ? 'Match' : s.status === 'fail' ? 'Mismatch' : s.status === 'pending' ? 'Pending' : 'Skipped'}</span>}
                        </motion.li>
                      );
                    })}
                  </ol>
                  <AnimatePresence>{done && (
                    <motion.div className={`verdict big ${run.verdict === 'pass' ? 'ok' : run.verdict === 'fail' ? 'fail' : 'pending'}`} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
                      <span className="verdict-icon">{run.verdict === 'pass' ? '✓' : run.verdict === 'fail' ? '✕' : '◷'}</span>
                      <div><strong>{run.verdict === 'pass' ? 'Verified — every check matches' : run.verdict === 'fail' ? `Mismatch at: ${run.firstFail?.label ?? run.steps.find((s) => s.status === 'fail')?.label}` : 'Everything published so far matches — some checks are pending'}</strong>
                        <div className="small muted">{run.steps.filter((s) => s.status === 'pass').length}/{run.steps.length} checks passed · computed in your browser {run.verdict === 'pending' && '· OpenTimestamps proofs confirm on Bitcoin after a few hours'}</div></div>
                    </motion.div>
                  )}</AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </Card></Rise>

          <div className="verify-grid">
            <Rise><Card>
              <h3 className="card-title">Sealed audit chain</h3>
              <SealPanel d={d} compact />
              <div className="row-gap" style={{ marginTop: 12 }}>
                <a className="btn btn-ghost btn-sm" href={`/api/draws/${d.id}/chain.json?download=1`} download>↓ Public chain file (JSON)</a>
                {run?.derived?.chainFinalHash && <span className={`chip ${run.derived.chainFinalHash === d.seal.hash ? 'chip-ok' : 'chip-bad'}`}>{run.derived.chainFinalHash === d.seal.hash ? 'Match' : 'Mismatch'} · recomputed {run.derived.chainFinalHash.slice(0, 10)}…</span>}
              </div>
              <p className="small muted">Records are privacy-masked: masked display name and a salted identity commitment instead of email or full name. Each record hashes the previous one, starting from <span className="mono">sha256("luckydraw-ledger-v1|draw:{d.id}|commitment")</span>.</p>
              {run?.bundle?.chain && <ChainTable records={run.bundle.chain.records} />}
            </Card></Rise>
            <Rise><Card>
              <h3 className="card-title">External anchors</h3>
              <AnchorList drawId={d.id} />
              <details className="howto"><summary>Verify a proof independently</summary>
                <ul className="small">
                  <li><strong>OpenTimestamps:</strong> download the <span className="mono">.ots</span> file, then run <span className="mono">ots verify file.ots -d &lt;digest&gt;</span> or drop it on <a className="link" href="https://opentimestamps.org" target="_blank" rel="noreferrer">opentimestamps.org</a>. The digest is <span className="mono">sha256</span> of the anchor's digest input, which names the sealed hash.</li>
                  <li><strong>RFC 3161:</strong> <span className="mono">openssl ts -verify -digest &lt;digest&gt; -in proof.tsr -CAfile cacert.pem -untrusted tsa.crt</span></li>
                  <li>The one-click check above confirms in-browser that each proof commits to the displayed digest and that the digest input contains the sealed hash. Confirming the Bitcoin attestation itself needs a Bitcoin block header (the <span className="mono">ots</span> client does this).</li>
                </ul>
              </details>
            </Card></Rise>
          </div>

          {drawn && audit && done && <Derivation audit={audit} derived={run.derived} steps={run.steps} />}
          {drawn && !audit && <Card className="note-card"><p className="muted">Press <strong>Verify this draw</strong> to load the published seed derivation, receipt codes and re-run the wheel.</p></Card>}
          {run?.result && (
            <Rise><Card className="recompute-card">
              <h3 className="card-title">Re-run with the derived final seed</h3>
              <div className="recompute">
                <div className="verify-wheel"><DrawWheel ref={wheel} size={260} spinDuration={4.5} slices={run.result.slices} totalWeight={run.result.totalWeight} result={{ ticket: run.result.ticket, totalWeight: run.result.totalWeight, winnerEntryId: run.result.winner.entryId }} /></div>
                <dl className="kv">
                  <dt>u = seedrandom(finalSeed)()</dt><dd className="mono">{run.result.u}</dd>
                  <dt>ticket = floor(u × {run.result.totalWeight})</dt><dd className="mono">{run.result.ticket}</dd>
                  <dt>Winning entry</dt><dd><strong className="gold">#{run.result.winner.entryId} · {run.result.winner.name}</strong></dd>
                  <dt>Published winner</dt><dd className="mono">#{audit.winnerEntryId} {run.result.winner.entryId === Number(audit.winnerEntryId) ? '— Match' : '— Mismatch'}</dd>
                </dl>
              </div>
              <div className="row-gap"><Button className="btn-ghost btn-sm" onClick={() => downloadJson(`luckydraw-draw-${d.id}-bundle.json`, run.bundle)}>↓ Download verification bundle</Button><Link className="link small" to="/verify">Paste your own record →</Link></div>
            </Card></Rise>
          )}
        </>
      )}
    </Page>
  );
}

function ChainTable({ records }) {
  const [all, setAll] = useState(false);
  const rows = all ? records : records.slice(-6);
  return (
    <div className="table-wrap chain-table">
      <table className="table compact">
        <thead><tr><th>#</th><th>Time</th><th>Entrant</th><th className="num">Entries</th><th>prev → record hash</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.drawSeq}><td className="muted">{r.drawSeq}</td><td className="small muted nowrap">{dateTime(r.createdAt)}</td><td className="small">{r.userDisplay}</td><td className="num">{r.entryCount}</td>
            <td className="mono small muted nowrap">{r.prevHash.slice(0, 8)}… → <span className="gold">{r.recordHash.slice(0, 8)}…</span></td></tr>
        ))}</tbody>
      </table>
      {records.length > 6 && <button className="link small" onClick={() => setAll((a) => !a)}>{all ? 'Show last 6' : `Show all ${records.length} records`}</button>}
    </div>
  );
}

function Derivation({ audit, derived, steps }) {
  const st = (k) => steps.find((s) => s.key === k)?.status;
  const Mark = ({ k }) => <span className={`vstep-tag ${st(k)}`}>{st(k) === 'pass' ? 'Match' : st(k) === 'fail' ? 'Mismatch' : st(k)}</span>;
  const pe = audit.publicEntropy ?? {};
  const [codes, setCodes] = useState(false);
  return (
    <Rise><Card className="derivation">
      <h3 className="card-title">Seed derivation <span className="chip">{audit.seedDerivation ?? SEED_DERIVATION}</span></h3>
      <ol className="deriv">
        <li><div className="deriv-h">1 · Server seed revealed <Mark k="commitment" /></div>
          <div className="deriv-v"><span className="k">serverSeed</span><Hash value={audit.serverSeed} full label="server seed" /></div>
          <div className="deriv-v"><span className="k">sha256(serverSeed)</span><Hash value={sha256Hex(audit.serverSeed)} full /></div>
          <div className="deriv-v"><span className="k">published at open</span><Hash value={audit.commitment} full /></div></li>
        <li><div className="deriv-h">2 · Crowd entropy from {audit.receiptCodes.length} receipt codes <Mark k="crowd" /></div>
          <div className="small muted">SHA-256 over the receipt codes, upper-cased, sorted ascending (byte order) and joined with <span className="mono">\n</span>, UTF-8 encoded. Codes are random and contain no personal data.</div>
          <button className="link small" onClick={() => setCodes((c) => !c)}>{codes ? 'Hide' : 'Show'} receipt codes</button>
          {codes && <pre className="json codes">{crowdEntropyInput(audit.receiptCodes)}</pre>}
          <div className="deriv-v"><span className="k">crowdEntropy</span><Hash value={derived.crowdEntropy} full /></div></li>
        <li><div className="deriv-h">3 · External beacon, fixed after close <Mark k="public" /></div>
          {pe.value ? <div className="deriv-v"><span className="k">drand round {pe.round}</span><Hash value={pe.value} full /> <a className="link small" href={pe.url} target="_blank" rel="noreferrer">source ↗</a></div>
            : <div className="small muted">No beacon value ({pe.source}{pe.note ? ` — ${pe.note}` : ''}).</div>}
          <div className="deriv-v"><span className="k">publicRandom = SHA-256(crowdEntropy ‖ beacon)</span><Hash value={derived.publicRandom} full /></div></li>
        <li><div className="deriv-h">4 · Final seed <Mark k="seed" /></div>
          <div className="deriv-v"><span className="k">sealHash</span><Hash value={audit.sealHash} full /></div>
          <div className="deriv-v"><span className="k">HMAC-SHA256(serverSeed, publicRandom ‖ sealHash)</span><Hash value={derived.finalSeed} full /></div>
          <div className="deriv-v"><span className="k">published finalSeed</span><Hash value={audit.finalSeed} full /></div></li>
      </ol>
      <p className="small muted">Why both crowd entropy and a beacon? The last entrant (or the operator) could keep re-entering until the receipt-code hash looked favourable; mixing in a drand round that did not exist at seal time, under an HMAC keyed by a seed committed before any entry, means no single party can predict or grind the outcome. ‖ is byte concatenation of the hex-decoded 32-byte values.</p>
    </Card></Rise>
  );
}
