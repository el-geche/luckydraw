import { sha256, maskName, iso, randomReceiptCode } from '../util.js';
import { config } from '../config.js';
import { sendMail } from '../mail/index.js';
import { notFound } from '../errors.js';

const fmt = (c) => `$${(c / 100).toFixed(2)}`;

/** Canonical receipt payload — its sha256 is the receipt (entry) hash. The code itself is random (80 bits). */
export function receiptPayload({ code, drawId, userId, entryIds, tickets, costCents, createdAt, seedCommitment }) {
  return { v: 2, code, drawId, userId, entryIds: [...entryIds].sort((a, b) => a - b), tickets, costCents, createdAt: new Date(createdAt).toISOString(), seedCommitment };
}
export const receiptHash = (payload) => sha256(JSON.stringify(payload));
export const normalizeCode = (code) => String(code || '').trim().toUpperCase();
export const RECEIPT_CODE_RE = /^LD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export async function createReceipt(q, { draw, userId, entryIds, tickets, costCents, now }) {
  const code = randomReceiptCode();
  const payload = receiptPayload({ code, drawId: draw.id, userId, entryIds, tickets, costCents, createdAt: now, seedCommitment: draw.seed_commitment });
  const hash = receiptHash(payload);
  const { rows } = await q.query(
    `INSERT INTO entry_receipts (code, payload_hash, draw_id, user_id, entry_ids, tickets, cost_cents, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [code, hash, draw.id, userId, payload.entryIds, tickets, costCents, now]);
  return rows[0];
}

/**
 * Public lookup (no login). Never returns email or full name — only a masked display name.
 * Also checks the receipt's record in the draw's confirmation chain.
 */
export async function lookupReceipt(q, rawCode, { verifyChainForDraw } = {}) {
  const code = normalizeCode(rawCode);
  if (!RECEIPT_CODE_RE.test(code)) return { found: false, code, reason: 'Not a valid receipt code format (LD-XXXX-XXXX-XXXX-XXXX).' };
  const { rows } = await q.query(
    `SELECT r.*, d.title, d.status, d.mode, d.seed_commitment, d.result, d.closes_at, d.winner_entry_id, d.seal_hash, d.seal_count, d.sealed_at, u.name
     FROM entry_receipts r JOIN draws d ON d.id = r.draw_id JOIN users u ON u.id = r.user_id WHERE r.code = $1`, [code]);
  const r = rows[0];
  if (!r) return { found: false, code, reason: 'No receipt with that code exists.' };
  const payload = receiptPayload({ code: r.code, drawId: r.draw_id, userId: r.user_id, entryIds: r.entry_ids, tickets: r.tickets, costCents: r.cost_cents, createdAt: r.created_at, seedCommitment: r.seed_commitment });
  const recomputed = receiptHash(payload);
  const { rows: live } = await q.query('SELECT id FROM entries WHERE draw_id = $1 AND user_id = $2 AND id = ANY($3)', [r.draw_id, r.user_id, r.entry_ids]);
  const liveIds = new Set(live.map((x) => x.id));
  const published = r.result?.entries ? new Set(r.result.entries.map((e) => e.entryId)) : null;
  const chain = verifyChainForDraw ? await verifyChainForDraw(r.draw_id, r.code) : null;
  const { userId: _omit, ...publicPayload } = payload; // the internal user id is not needed publicly
  return {
    found: true, code: r.code, receiptHash: r.payload_hash, recomputedHash: recomputed, hashValid: recomputed === r.payload_hash,
    payload: publicPayload, holder: maskName(r.name), createdAt: iso(r.created_at), entryCount: r.entry_ids.length, tickets: r.tickets,
    draw: { id: r.draw_id, title: r.title, status: r.status, mode: r.mode, seedCommitment: r.seed_commitment, closesAt: iso(r.closes_at), sealHash: r.seal_hash, sealCount: r.seal_count, sealedAt: iso(r.sealed_at) },
    entries: r.entry_ids.map((id) => ({ entryId: id, tickets: r.tickets, recorded: liveIds.has(id), inPublishedList: published ? published.has(id) : null, won: r.winner_entry_id === id })),
    chain,
  };
}

export function renderReceiptEmail({ user, draw, receipt }) {
  const verifyUrl = `${config.appUrl}/verify-receipt?code=${encodeURIComponent(receipt.code)}`;
  const drawUrl = `${config.appUrl}/draws/${draw.id}`;
  const ids = receipt.entry_ids.map((i) => `#${i}`).join(', ');
  const when = new Date(receipt.created_at).toISOString();
  const subject = `[DEMO] Entry confirmed — ${draw.title} (receipt ${receipt.code})`;
  const text = [
    `LuckyDraw — DEMO PLATFORM. No real money. This confirmation is simulated.`, '',
    `Hi ${user.name.split(' ')[0]},`, '', `Your entry into "${draw.title}" (draw #${draw.id}) is confirmed.`, '',
    `Receipt code:     ${receipt.code}`, `Entry IDs:        ${ids}`, `Tickets per entry: ${receipt.tickets}`,
    `Amount (demo):    ${fmt(receipt.cost_cents)} simulated credits`, `Timestamp (UTC):  ${when}`,
    `Entry hash:       ${receipt.payload_hash}`, `Seed commitment:  ${draw.seed_commitment}`, '',
    `Verify this receipt: ${verifyUrl}`, `View the draw:       ${drawUrl}`, '',
    `After the draw, the seed and full ordered entry list are published so you can confirm your entries were included.`,
  ].join('\n');
  const row = (k, v, mono = true) => `<tr><td style="padding:8px 0;color:#8b98ae;font-size:13px;width:150px;vertical-align:top">${k}</td><td style="padding:8px 0;color:#e5eaf3;font-size:13px;${mono ? 'font-family:Menlo,Consolas,monospace;word-break:break-all' : ''}">${v}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#0a1222;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e5eaf3">
<div style="background:#2a2210;color:#e9d39c;text-align:center;font-size:12px;padding:8px;letter-spacing:.04em"><b style="letter-spacing:.12em">DEMO PLATFORM</b> · No real money · Simulated confirmation</div>
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <div style="font-size:20px;font-weight:700;margin-bottom:4px"><span style="color:#c9a24a">●</span> LuckyDraw</div>
  <div style="background:#111c34;border:1px solid rgba(148,163,184,.18);border-radius:14px;padding:26px;margin-top:18px">
    <div style="color:#c9a24a;text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:600">Proof of entry</div>
    <h1 style="font-size:22px;margin:8px 0 6px">Entry confirmed</h1>
    <p style="color:#c2cbdb;font-size:14px;margin:0 0 16px">Hi ${user.name.split(' ')[0]}, your entry into <b>${draw.title}</b> (draw #${draw.id}) has been recorded.</p>
    <div style="text-align:center;border:1px dashed rgba(201,162,74,.5);border-radius:10px;padding:14px;margin:6px 0 16px">
      <div style="color:#8b98ae;font-size:11px;letter-spacing:.12em;text-transform:uppercase">Receipt code</div>
      <div style="font-family:Menlo,Consolas,monospace;font-size:22px;color:#e6c77f;letter-spacing:.06em">${receipt.code}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Draw', `#${draw.id} · ${draw.title}`, false)}${row('Entry IDs', ids)}${row('Tickets / entry', String(receipt.tickets))}
      ${row('Amount', `${fmt(receipt.cost_cents)} <span style="color:#e6c77f">(simulated demo credits)</span>`, false)}${row('Timestamp (UTC)', when)}
      ${row('Entry hash', receipt.payload_hash)}${row('Seed commitment', draw.seed_commitment)}
    </table>
    <div style="margin-top:22px"><a href="${verifyUrl}" style="display:inline-block;background:#c9a24a;color:#14100a;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px;font-size:14px">Verify this receipt</a>
    <a href="${drawUrl}" style="display:inline-block;color:#e6c77f;text-decoration:none;font-size:14px;margin-left:14px">View draw →</a></div>
  </div>
  <p style="color:#8b98ae;font-size:12px;margin-top:18px;line-height:1.6">After the draw the seed and the complete ordered entry list are published; your receipt page will then show whether each entry appears in the published list. This message was generated by a demonstration system. No payment was taken and no real prize is offered.</p>
</div></body></html>`;
  return { subject, text, html };
}

export async function sendEntryReceiptEmail(db, receipt, { transport, now } = {}) {
  const { rows: [user] } = await db.query('SELECT * FROM users WHERE id = $1', [receipt.user_id]);
  const { rows: [draw] } = await db.query('SELECT * FROM draws WHERE id = $1', [receipt.draw_id]);
  const msg = renderReceiptEmail({ user, draw, receipt });
  return sendMail(db, { userId: user.id, to: user.email, ...msg, kind: 'entry_receipt', drawId: draw.id, receiptCode: receipt.code, now, ...(transport ? { transport } : {}) });
}
