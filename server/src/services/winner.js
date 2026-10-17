/** Winner notification email (with the fairness report PDF attached) + announcement helpers. */
import { config } from '../config.js';
import { sendMail } from '../mail/index.js';
import { logEvent } from './logs.js';
import { buildReportData, renderReportPdf } from './report.js';
import { conflict } from '../errors.js';
import crypto from 'node:crypto';
import { maskName } from '../util.js';
import { logAnnouncement } from './events.js';

const fmt = (c) => `$${(c / 100).toFixed(2)}`;

export async function notifyWinner(db, drawId, { actor = 'system', resend = false, now = new Date() } = {}) {
  const { rows: [draw] } = await db.query('SELECT * FROM draws WHERE id = $1', [drawId]);
  if (!draw || draw.status !== 'drawn' || !draw.sealed_at || !draw.result?.winnerEntryId) throw conflict('Winner notifications are only generated after the draw is sealed and run.', 'NOT_DRAWN');
  const { rows: [user] } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [draw.winner_user_id]);
  const r = draw.result;
  const pdf = await renderReportPdf(await buildReportData(db, draw));
  const verifyUrl = `${config.appUrl}/verify/${draw.id}`;
  const announceUrl = `${config.appUrl}/draws/${draw.id}/winner`;
  const subject = `[DEMO] You won “${draw.title}” — winning number ${r.ticket}`;
  const text = [
    'LuckyDraw — DEMO PLATFORM. No real money. This notification and payout are simulated.', '',
    `Congratulations ${user.name.split(' ')[0]},`, '', `Your entry #${r.winnerEntryId} won "${draw.title}" (draw #${draw.id}).`, '',
    `Winning number:  ticket ${r.ticket} of ${r.totalWeight}`, `Receipt code:    ${r.winnerReceiptCode ?? '—'}`, `Prize:           ${fmt(draw.prize_cents)} (demo credits)`,
    'Payout:          credited to your simulated demo wallet — no real money is paid.', `Sealed hash:     ${draw.seal_hash}`, '',
    `Verify the draw: ${verifyUrl}`, `Announcement:    ${announceUrl}`, '', 'The attached Fairness Report summarises how this result can be independently verified.',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#0a1222;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e5eaf3">
<div style="background:#2a2210;color:#e9d39c;text-align:center;font-size:12px;padding:8px"><b style="letter-spacing:.12em">DEMO PLATFORM</b> · No real money · Simulated payout</div>
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<div style="font-size:20px;font-weight:700"><span style="color:#c9a24a">●</span> LuckyDraw</div>
<div style="background:#111c34;border:1px solid rgba(201,162,74,.4);border-radius:14px;padding:26px;margin-top:18px">
<div style="color:#c9a24a;text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:600">Winner notification</div>
<h1 style="font-size:24px;margin:8px 0">Congratulations, ${user.name.split(' ')[0]}</h1>
<p style="color:#c2cbdb;font-size:14px">Your entry won <b>${draw.title}</b> (draw #${draw.id}).</p>
<div style="text-align:center;border:1px dashed rgba(201,162,74,.5);border-radius:10px;padding:16px;margin:14px 0">
<div style="color:#8b98ae;font-size:11px;letter-spacing:.12em;text-transform:uppercase">Winning number</div>
<div style="font-size:40px;font-weight:700;color:#e6c77f">${r.ticket}</div><div style="color:#8b98ae;font-size:12px">of ${r.totalWeight} · entry #${r.winnerEntryId}</div></div>
<table style="width:100%;font-size:13px;border-collapse:collapse">
<tr><td style="color:#8b98ae;padding:6px 0;width:140px">Receipt code</td><td style="font-family:Menlo,monospace">${r.winnerReceiptCode ?? '—'}</td></tr>
<tr><td style="color:#8b98ae;padding:6px 0">Prize</td><td>${fmt(draw.prize_cents)} <span style="color:#e6c77f">(demo credits)</span></td></tr>
<tr><td style="color:#8b98ae;padding:6px 0">Payout</td><td>Credited to your simulated demo wallet. No real money is paid.</td></tr>
<tr><td style="color:#8b98ae;padding:6px 0">Sealed hash</td><td style="font-family:Menlo,monospace;word-break:break-all;font-size:11px">${draw.seal_hash}</td></tr></table>
<div style="margin-top:20px"><a href="${verifyUrl}" style="display:inline-block;background:#c9a24a;color:#14100a;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px;font-size:14px">Verify this draw</a>
<a href="${announceUrl}" style="color:#e6c77f;text-decoration:none;font-size:14px;margin-left:14px">Announcement →</a></div></div>
<p style="color:#8b98ae;font-size:12px;margin-top:16px">Attached: one-page Fairness Report (PDF). Demonstration system — no payment was taken and no real prize is offered.</p></div></body></html>`;
  await logAnnouncement(db, { drawId: draw.id, userId: user.id, event: resend ? 'winner_email_resent' : 'winner_email_queued', actor, now, details: { attachment: 'fairness-report.pdf' } });
  // Open tracking pixel: only when SMTP is configured AND explicitly enabled (off by default).
  const tracking = config.mail.transport === 'smtp' && config.openTracking;
  const trackToken = tracking ? crypto.randomBytes(16).toString('base64url') : null;
  const htmlOut = tracking ? html.replace('</body>', `<img src="${config.appUrl}/api/t/open/${trackToken}.gif" width="1" height="1" alt=""></body>`) : html;
  let mail;
  try {
    mail = await sendMail(db, {
    userId: user.id, to: user.email, subject, html: htmlOut, text, kind: resend ? 'winner_notification_resend' : 'winner_notification', drawId: draw.id, receiptCode: r.winnerReceiptCode, now,
    attachments: [{ filename: `luckydraw-fairness-report-draw-${draw.id}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });
  } catch (e) {
    await logAnnouncement(db, { drawId: draw.id, userId: user.id, event: 'winner_email_failed', actor, now, details: { error: String(e.message).slice(0, 300) } });
    throw e;
  }
  if (trackToken) await db.query('UPDATE outbox_emails SET track_token = $2 WHERE id = $1', [mail.id, trackToken]);
  await logAnnouncement(db, { drawId: draw.id, userId: user.id, event: mail.transport === 'smtp' ? 'winner_email_accepted_smtp' : 'winner_email_delivered_demo', actor: 'mail', emailId: mail.id, now,
    details: { status: mail.transport === 'smtp' ? 'accepted by SMTP' : 'delivered (demo)', messageId: mail.messageId, openTracking: tracking } });
  await logEvent(db, { drawId: draw.id, event: resend ? 'winner_notification_resent' : 'winner_notified', actor, now, details: { emailId: mail.id, transport: mail.transport, to: maskName(user.name), attachment: `luckydraw-fairness-report-draw-${draw.id}.pdf`, pdfBytes: pdf.length } });
  return mail;
}

/** Can `viewer` see the announcement? public = everyone; unlisted = anyone with the link; organizer = admins only. */
export function announcementAccess(draw, viewer) {
  if (draw.status !== 'drawn' || !draw.sealed_at) return { visible: false, listed: false };
  const v = draw.announcement_visibility;
  if (viewer?.role === 'admin') return { visible: true, listed: v === 'public' };
  if (v === 'public') return { visible: true, listed: true };
  if (v === 'unlisted') return { visible: true, listed: false };
  return { visible: false, listed: false };
}
