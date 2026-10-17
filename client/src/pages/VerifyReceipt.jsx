import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { api } from '../lib/api.js';
import { Button, Card, Hash, ModeChip, StatusBadge } from '../components/ui.jsx';
import { dateTime, utcTime } from '../lib/format.js';

/** Public, no-login receipt verification. Deep link: /verify-receipt?code=LD-… */
export default function VerifyReceipt() {
  const [params, setParams] = useSearchParams();
  const code = params.get('code') || '';
  const [input, setInput] = useState(code);
  const [r, setR] = useState(null);
  const [state, setState] = useState('idle'); // idle | busy | done | limited | error
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!code) { setR(null); setState('idle'); return; }
    setInput(code); setState('busy'); setR(null);
    api(`/receipts/${encodeURIComponent(code)}`)
      .then((x) => { setR(x); setState('done'); })
      .catch((e) => {
        if (e.status === 404) { setR(e.body); setState('done'); }
        else if (e.status === 429) { setState('limited'); setMsg(e.message); }
        else { setState('error'); setMsg(e.message); }
      });
  }, [code]);
  const submit = (e) => { e.preventDefault(); const c = input.trim().toUpperCase(); if (c) setParams({ code: c }); };
  return (
    <Page className="receipt">
      <Rise className="page-head"><div>
        <div className="eyebrow">Public · no login</div><h1>Verify a receipt</h1>
        <p className="lead small-lead">Every entry confirmation carries a random, unguessable receipt code. Enter one to confirm the entry was recorded and that its record checks out in the draw's tamper-evident audit chain. Only a masked display name is ever shown.</p>
      </div></Rise>
      <Rise><Card>
        <form className="row-gap" onSubmit={submit}>
          <input className="input mono receipt-input" placeholder="LD-XXXX-XXXX-XXXX-XXXX" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Receipt code" autoComplete="off" spellCheck={false} />
          <Button type="submit" loading={state === 'busy'}>Verify</Button>
        </form>
        {state === 'limited' && <div className="note note-danger">{msg || 'Too many lookups from this network. Please wait a minute and try again.'}</div>}
        {state === 'error' && <div className="note note-danger">{msg}</div>}
      </Card></Rise>
      <AnimatePresence mode="wait">
        {state === 'done' && r && (r.found ? <Found key={r.code} r={r} /> : (
          <motion.div key="nf" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="receipt-result"><div className="verdict fail"><span className="verdict-icon">✕</span><div><strong>Not found</strong><div className="small muted">{r.reason || 'No receipt with that code exists.'} Check the code in your confirmation email.</div></div></div></Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </Page>
  );
}

function Found({ r }) {
  const c = r.chain;
  const chainOk = c?.recordFound && c.recordHashValid && c.linkedToPrevious && c.chainIntact;
  const ok = r.hashValid && chainOk;
  const checks = [
    ['Receipt hash recomputes from the recorded entry details', r.hashValid],
    ['Audit-chain record found for this receipt', c?.recordFound],
    ['Record hash recomputes (record not altered)', c?.recordHashValid],
    ['Record links to the previous record in the chain', c?.linkedToPrevious],
    ['Whole draw chain intact', c?.chainIntact],
    ...(c?.sealed ? [['Chain matches the sealed final hash', c.sealMatch]] : []),
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
      <Card className="receipt-result">
        <div className={`verdict ${ok ? 'ok' : 'fail'}`}><span className="verdict-icon">{ok ? '✓' : '✕'}</span>
          <div><strong>{ok ? 'Valid receipt' : 'Receipt found, but a check failed'}</strong><div className="small muted">Held by <strong>{r.holder}</strong> · {r.entryCount} entr{r.entryCount === 1 ? 'y' : 'ies'}{r.tickets > 1 ? ` × ${r.tickets} tickets` : ''}</div></div></div>
        <div className="two-col">
          <dl className="kv">
            <dt>Receipt code</dt><dd className="mono">{r.code}</dd>
            <dt>Entered (your time)</dt><dd>{dateTime(r.createdAt)}</dd>
            <dt>Entered (UTC)</dt><dd className="mono small">{utcTime(r.createdAt)}</dd>
            <dt>Draw</dt><dd><Link className="link" to={r.draw.status === 'drawn' ? `/draws/${r.draw.id}/results` : `/draws/${r.draw.id}`}>#{r.draw.id} {r.draw.title}</Link></dd>
            <dt>Draw status</dt><dd className="row-gap"><StatusBadge status={r.draw.status} /><ModeChip mode={r.draw.mode} /></dd>
            <dt>Entry IDs</dt><dd className="mono small">{r.entries.map((e) => `#${e.entryId}${e.won ? ' (winner)' : ''}`).join(', ')}</dd>
            <dt>Receipt hash</dt><dd><Hash value={r.receiptHash} n={12} /></dd>
            {c?.recordHash && <><dt>Chain record</dt><dd className="small">#{c.drawSeq} · <Hash value={c.recordHash} n={10} /></dd></>}
            {c?.sealed && <><dt>Sealed hash</dt><dd><Hash value={c.sealHash} n={10} /></dd></>}
          </dl>
          <ul className="checks">
            {checks.map(([label, pass], i) => (
              <motion.li key={label} className={pass ? 'ok' : 'fail'} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + i * 0.1 }}>
                <span className="check-icon">{pass ? '✓' : '✕'}</span><div>{label}</div>
              </motion.li>
            ))}
            {r.entries[0]?.inPublishedList != null && (
              <motion.li className={r.entries.every((e) => e.inPublishedList) ? 'ok' : 'fail'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
                <span className="check-icon">{r.entries.every((e) => e.inPublishedList) ? '✓' : '✕'}</span><div>Entries included in the published draw list</div>
              </motion.li>
            )}
          </ul>
        </div>
        {r.draw.sealHash && <Link className="btn btn-ghost btn-sm" to={`/verify/${r.draw.id}`}>Verify the whole draw →</Link>}
      </Card>
    </motion.div>
  );
}

export function LegacyReceiptRedirect() {
  const { code } = useParams();
  return <Navigate to={code ? `/verify-receipt?code=${encodeURIComponent(code)}` : '/verify-receipt'} replace />;
}
