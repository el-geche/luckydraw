import { useState } from 'react';
import { STATIC_PREVIEW } from '../lib/staticMode.js';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Card, Skeleton, Empty, Tabs } from '../components/ui.jsx';
import { dateTime } from '../lib/format.js';

export default function Outbox() {
  const { user, ready } = useAuth();
  const [scope, setScope] = useState('mine');
  const { data: list } = useApi(user ? (scope === 'all' ? '/admin/outbox' : '/me/outbox') : null, { poll: 5000, deps: [user?.id] });
  const [params] = useSearchParams();
  const [sel, setSel] = useState(params.get('id') ? Number(params.get('id')) : null);
  const current = sel ?? list?.[0]?.id ?? null;
  const { data: mail } = useApi(current ? `/me/outbox/${current}` : null);
  if (ready && !user) return <Navigate to="/login?next=/outbox" replace />;
  return (
    <Page className="outbox">
      <Rise className="page-head">
        <div><div className="eyebrow">Development mail</div><h1>Demo outbox</h1>
          <p className="lead small-lead">Entry confirmations, reminders and winner notifications are rendered as real messages but <strong>not delivered</strong>. {STATIC_PREVIEW ? <>In demo mode they are stored only in this browser (IndexedDB) and listed here.</> : <>They are saved to <span className="mono">server/.data/outbox/*.eml</span> and listed here.</>}</p></div>
        {user?.role === 'admin' && <Tabs value={scope} onChange={(v) => { setScope(v); setSel(null); }} tabs={[{ value: 'mine', label: 'My mail' }, { value: 'all', label: 'All outgoing mail' }]} />}
      </Rise>
      {!list ? <Skeleton h={400} /> : !list.length ? <Empty title="No messages yet">Enter a draw and your proof-of-entry email will appear here. <Link className="link" to="/">Browse draws →</Link></Empty> : (
        <div className="outbox-grid">
          <Card className="mail-list">
            {list.map((m) => (
              <motion.button key={m.id} layout className={`mail-item${current === m.id ? ' active' : ''}`} onClick={() => setSel(m.id)} whileHover={{ x: 2 }}>
                <div className="row-between"><span className="small muted">{scope === 'all' ? m.to : 'LuckyDraw Demo'}</span><span className="small muted nowrap">{dateTime(m.createdAt)}</span></div>
                <div className="mail-subject">{m.subject}</div>
                <div className="row-gap small"><span className="chip">{m.transport === 'outbox' ? 'Not sent · saved to outbox' : m.transport}</span>{m.attachments?.length > 0 && <span className="chip chip-gold">📎 PDF</span>}{m.receiptCode && <span className="mono muted">{m.receiptCode}</span>}</div>
              </motion.button>
            ))}
          </Card>
          <Card className="mail-view">
            <AnimatePresence mode="wait">
              {mail && (
                <motion.div key={mail.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <dl className="kv mail-head">
                    <dt>To</dt><dd>{mail.to}</dd><dt>Subject</dt><dd>{mail.subject}</dd>
                    <dt>Transport</dt><dd><span className="mono">{mail.transport}</span>{mail.file && <span className="muted small"> · {mail.file}</span>}</dd>
                    {mail.receiptCode && (<><dt>Receipt</dt><dd><Link className="link mono" to={`/verify-receipt?code=${mail.receiptCode}`}>{mail.receiptCode} →</Link></dd></>)}
                    {mail.attachments?.length > 0 && (<><dt>Attached</dt><dd className="row-gap">{mail.attachments.map((a) => (
                      <a key={a.filename} className="chip chip-gold" href={a.contentType === 'application/pdf' && mail.drawId ? `/api/draws/${mail.drawId}/report.pdf?source=email` : undefined} download>📎 {a.filename} · {Math.round(a.size / 1024)} KB</a>
                    ))}</dd></>)}
                  </dl>
                  <iframe title="Email preview" className="mail-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mail.html.replace('<head>', '<head><base target="_blank">')} />
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>
      )}
    </Page>
  );
}
