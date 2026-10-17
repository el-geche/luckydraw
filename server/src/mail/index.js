/**
 * Dev-safe mail layer.
 *  - MAIL_TRANSPORT=outbox (default): nodemailer streamTransport renders a real RFC-822
 *    message which is written to server/.data/outbox/<id>.eml (+ .html preview). Nothing is sent.
 *  - MAIL_TRANSPORT=smtp: additionally delivers via SMTP_HOST/PORT/USER/PASS.
 *  - MAIL_TRANSPORT=none: record in the DB outbox only (used by tests).
 * Every message is also stored in the outbox_emails table for the in-app "Demo outbox".
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let smtp = null;
const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

function smtpTransport() {
  if (!smtp) {
    const s = config.mail.smtp;
    if (!s.host) throw new Error('MAIL_TRANSPORT=smtp requires SMTP_HOST');
    smtp = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
  }
  return smtp;
}

export async function sendMail(db, { userId = null, to, subject, html, text, kind = 'entry_receipt', drawId = null, receiptCode = null, transport = config.mail.transport, outboxDir = config.outboxDir, now = new Date(), attachments = [], headers = {} }) {
  const message = { from: config.mail.from, to, subject, html, text, attachments, headers: { 'X-LuckyDraw-Demo': 'true', ...headers } };
  let messageId = null;
  let filePath = null;
  if (transport !== 'none') {
    const rendered = await stream.sendMail(message);
    messageId = rendered.messageId;
    fs.mkdirSync(outboxDir, { recursive: true });
    const base = `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${kind}-${receiptCode || 'msg'}`;
    filePath = path.join(outboxDir, `${base}.eml`);
    fs.writeFileSync(filePath, rendered.message);
    fs.writeFileSync(path.join(outboxDir, `${base}.html`), html);
  }
  if (transport === 'smtp') {
    const info = await smtpTransport().sendMail(message);
    messageId = info.messageId;
  }
  const { rows } = await db.query(
    `INSERT INTO outbox_emails (user_id, to_email, subject, html, text, kind, draw_id, receipt_code, transport, message_id, file_path, created_at, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING id`,
    [userId, to, subject, html, text, kind, drawId, receiptCode, transport, messageId, filePath, now, JSON.stringify(attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.content?.length ?? 0 })))]);
  return { id: rows[0].id, messageId, filePath, transport };
}

export function serializeEmail(e, { full = false } = {}) {
  return {
    id: e.id, userId: e.user_id, to: e.to_email, subject: e.subject, kind: e.kind, drawId: e.draw_id, receiptCode: e.receipt_code,
    transport: e.transport, messageId: e.message_id, file: e.file_path ? path.basename(e.file_path) : null,
    attachments: e.attachments ?? [], createdAt: new Date(e.created_at).toISOString(), ...(full ? { html: e.html, text: e.text } : {}),
  };
}
