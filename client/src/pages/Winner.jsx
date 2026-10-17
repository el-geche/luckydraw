import { Link, useParams } from 'react-router-dom';
import { useApiBlobUrl } from '../lib/useApiBlob.js';
import { motion } from 'framer-motion';
import { Page } from '../components/Page.jsx';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { Card, Hash, ModeChip, Skeleton, Button } from '../components/ui.jsx';
import { AnchorBadge, ReportButton } from '../components/Fairness.jsx';
import { money, dateTime, utcTime } from '../lib/format.js';

const ease = [0.22, 1, 0.36, 1];
export default function Winner() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data: a, error } = useApi(`/draws/${id}/announcement`, { deps: [user?.id] });
  if (error) return <Page><Card><h2>No announcement</h2><p className="muted">This draw has no winner announcement you can view. It may not have been drawn yet, or the organizer has kept it private.</p><Link className="btn btn-ghost" to={`/draws/${id}`}>Go to draw</Link></Card></Page>;
  if (!a) return <Page><Skeleton h={520} /></Page>;
  const share = async () => {
    const url = a.shareUrl || location.href;
    try { if (navigator.share) await navigator.share({ title: a.title, url }); else { await navigator.clipboard.writeText(url); toast('Share link copied', 'success'); } } catch { /* cancelled */ }
  };
  return (
    <Page className="winner-page">
      <div className="crumbs"><Link to="/history">History</Link><span>/</span><Link to={`/draws/${a.drawId}/results`}>#{a.drawId}</Link><span>/</span><span>Winner</span></div>
      {a.visibility !== 'public' && <div className="note small">Visibility: <strong>{a.visibility === 'unlisted' ? 'Unlisted — anyone with the link' : 'Organizer only'}</strong>. Social card and share page are disabled.</div>}
      <motion.section className="announce" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.14, delayChildren: 0.1 } } }}>
        <motion.div className="eyebrow" variants={{ h: { opacity: 0, y: 8 }, s: { opacity: 1, y: 0, transition: { ease } } }}>Winner announcement · {dateTime(a.drawnAt)}</motion.div>
        <motion.h1 variants={{ h: { opacity: 0, y: 10 }, s: { opacity: 1, y: 0, transition: { ease } } }}>{a.title}</motion.h1>
        <motion.div className="announce-number" variants={{ h: { opacity: 0, scale: 0.85, filter: 'blur(6px)' }, s: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.9, ease } } }}>
          <span className="muted small">Winning number</span>
          <strong>{a.winningNumber}</strong>
          <span className="muted small">ticket {a.winningNumber} of {a.totalWeight} · entry #{a.winnerEntryId}</span>
        </motion.div>
        <motion.div className="announce-name" variants={{ h: { opacity: 0, y: 8 }, s: { opacity: 1, y: 0, transition: { ease, duration: 0.6 } } }}>
          <span className="muted small">Winner</span><strong className="gold">{a.winnerDisplay}</strong>
          <span className="muted small">{a.winnerConsentFullName ? 'Full name shown with the winner’s consent' : 'Masked for privacy'}</span>
        </motion.div>
        <motion.div className="announce-prize" variants={{ h: { opacity: 0 }, s: { opacity: 1 } }}>{money(a.prizeCents)} <span className="tag-demo">DEMO PRIZE · SIMULATED PAYOUT</span> <ModeChip mode={a.mode} /></motion.div>
      </motion.section>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, ease }} className="two-col">
        <Card>
          <h3 className="card-title">Fairness</h3>
          <dl className="kv">
            <dt>Sealed hash</dt><dd><Hash value={a.seal.hash} n={12} label="sealed hash" /></dd>
            <dt>Records sealed</dt><dd>{a.seal.count} · {utcTime(a.seal.sealedAt)}</dd>
            <dt>External anchor</dt><dd>{a.anchor ? <><AnchorBadge status={a.anchor.status} /> <span className="small muted">{a.anchor.provider}{a.anchor.bitcoinBlock ? ` · block ${a.anchor.bitcoinBlock}` : ''}</span></> : <span className="muted">none configured</span>}</dd>
          </dl>
          <div className="row-gap"><Link className="btn btn-gold btn-sm" to={a.verifyUrl}>Verify this draw</Link><ReportButton drawId={a.drawId} source="announcement" /></div>
        </Card>
        <Card>
          <h3 className="card-title">Share</h3>
          {a.cardUrl ? <CardImage className="share-card" src={a.cardUrl} alt={`Social card for ${a.title}`} loading="lazy" /> : <p className="muted small">Sharing is available only for public announcements.</p>}
          {a.cardUrl && <div className="row-gap"><Button className="btn-ghost btn-sm" onClick={share}>Share announcement</Button><a className="link small" href={a.cardUrl} download>↓ Card (PNG)</a></div>}
          <p className="small muted">Verify URL: <span className="mono">{a.shortVerifyUrl}</span></p>
        </Card>
      </motion.div>
    </Page>
  );
}

function CardImage({ src, ...rest }) {
  const url = useApiBlobUrl(src);
  return url ? <img src={url} {...rest} /> : <div className="share-card skeleton" style={{ aspectRatio: '1200 / 630' }} />;
}
