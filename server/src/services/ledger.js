/**
 * Entry-confirmation audit trail (server side). One append-only hash chain per draw;
 * the hashing rules live in @luckydraw/shared (ledger.js) so browsers recompute identically.
 */
import crypto from 'node:crypto';
import { computeRecordHash, genesisInput, verifyDrawChain, publicRecord, LEDGER_VERSION, sha256Hex } from '@luckydraw/shared';
import { conflict } from '../errors.js';
import { maskName } from '../util.js';
import { config } from '../config.js';

const sha = (s) => sha256Hex(s);
export const identityCommitment = (userId, email, salt) => sha256Hex(`${userId}|${String(email).trim().toLowerCase()}|${salt}`);
export const deliveryChannel = (transport = config.mail.transport) => (transport === 'smtp' ? 'smtp' : transport === 'outbox' ? 'demo_outbox' : 'recorded_only');
export const drawGenesis = (drawId, seedCommitment) => sha256Hex(genesisInput(drawId, seedCommitment));

export function fromRow(row) {
  return {
    id: row.id, drawId: row.draw_id, drawSeq: row.draw_seq, createdAt: row.created_at_iso, userId: row.user_id, userName: row.user_name,
    userEmail: row.user_email, identitySalt: row.identity_salt, userDisplay: row.user_display, identityCommitment: row.identity_commitment,
    drawTitle: row.draw_title, entryIds: row.entry_ids, entryCount: row.entry_count, tickets: row.tickets, receiptCode: row.receipt_code,
    receiptHash: row.receipt_hash, deliveryChannel: row.delivery_channel, prevHash: row.prev_hash, recordHash: row.record_hash,
  };
}

/**
 * Append a confirmation record. MUST be called inside the entry transaction, with the
 * draw row already locked FOR UPDATE (enterDraw does this), so seq/prev are race-free.
 */
export async function appendConfirmation(q, { draw, user, receipt, now }) {
  if (draw.sealed_at || draw.status !== 'open') throw conflict('This draw’s audit chain is sealed; no further records can be appended.', 'CHAIN_SEALED');
  const { rows: [last] } = await q.query('SELECT draw_seq, record_hash FROM confirmation_ledger WHERE draw_id = $1 ORDER BY draw_seq DESC LIMIT 1', [draw.id]);
  const salt = crypto.randomBytes(16).toString('hex');
  const rec = {
    drawId: draw.id, drawSeq: (last?.draw_seq ?? 0) + 1, createdAt: new Date(now).toISOString(), userId: user.id,
    userDisplay: maskName(user.name), identityCommitment: identityCommitment(user.id, user.email, salt),
    entryIds: [...receipt.entry_ids].sort((a, b) => a - b), entryCount: receipt.entry_ids.length, tickets: receipt.tickets,
    receiptHash: receipt.payload_hash, deliveryChannel: deliveryChannel(), prevHash: last?.record_hash ?? drawGenesis(draw.id, draw.seed_commitment),
  };
  rec.recordHash = await computeRecordHash(rec, sha);
  await q.query(
    `INSERT INTO confirmation_ledger (draw_id, draw_seq, created_at_iso, user_id, user_name, user_email, identity_salt, user_display, identity_commitment,
       draw_title, entry_ids, entry_count, tickets, receipt_code, receipt_hash, delivery_channel, prev_hash, record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [rec.drawId, rec.drawSeq, rec.createdAt, user.id, user.name, user.email, salt, rec.userDisplay, rec.identityCommitment,
      draw.title, rec.entryIds, rec.entryCount, rec.tickets, receipt.code, rec.receiptHash, rec.deliveryChannel, rec.prevHash, rec.recordHash]);
  return rec;
}

/** Compute the seal for a draw (final record hash, or genesis when empty). */
export async function computeSeal(q, draw) {
  const { rows } = await q.query('SELECT draw_seq, record_hash FROM confirmation_ledger WHERE draw_id = $1 ORDER BY draw_seq DESC LIMIT 1', [draw.id]);
  const { rows: [{ n }] } = await q.query('SELECT COUNT(*)::int AS n FROM confirmation_ledger WHERE draw_id = $1', [draw.id]);
  return { hash: rows[0]?.record_hash ?? drawGenesis(draw.id, draw.seed_commitment), count: n };
}

export async function drawRecords(q, drawId) {
  const { rows } = await q.query('SELECT * FROM confirmation_ledger WHERE draw_id = $1 ORDER BY draw_seq ASC', [drawId]);
  return rows.map(fromRow);
}

/** Admin-side check: chain links + private identity fields (email/salt/name) match the public commitments. */
export async function verifyDraw(q, draw) {
  const records = await drawRecords(q, draw.id);
  const seal = draw.sealed_at ? { hash: draw.seal_hash, count: draw.seal_count } : null;
  const v = await verifyDrawChain({ drawId: draw.id, seedCommitment: draw.seed_commitment, records, seal }, { sha256: sha });
  for (const r of records) {
    if (identityCommitment(r.userId, r.userEmail, r.identitySalt) !== r.identityCommitment) v.problems.push({ drawSeq: r.drawSeq, problem: 'stored email does not match identity commitment' });
    if (maskName(r.userName) !== r.userDisplay) v.problems.push({ drawSeq: r.drawSeq, problem: 'stored name does not match masked display name' });
  }
  v.ok = v.problems.length === 0;
  return { drawId: draw.id, title: draw.title, status: draw.status, sealed: Boolean(draw.sealed_at), seal, ...v, steps: undefined };
}

export async function verifyAllChains(db) {
  const { rows: draws } = await db.query('SELECT * FROM draws ORDER BY id');
  const results = [];
  for (const d of draws) results.push(await verifyDraw(db, d));
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM confirmation_ledger');
  return { ok: results.every((r) => r.ok), version: LEDGER_VERSION, totalRecords: n, draws: results, verifiedAt: new Date().toISOString() };
}

/** Public chain file for a draw (no PII). Only once sealed. */
export async function publicChain(q, draw) {
  const records = await drawRecords(q, draw.id);
  return {
    format: 'luckydraw-public-chain', version: LEDGER_VERSION, drawId: draw.id, title: draw.title, seedCommitment: draw.seed_commitment,
    genesisInput: genesisInput(draw.id, draw.seed_commitment), genesisHash: drawGenesis(draw.id, draw.seed_commitment),
    seal: draw.sealed_at ? { hash: draw.seal_hash, count: draw.seal_count, sealedAt: new Date(draw.sealed_at).toISOString() } : null,
    hashRule: 'recordHash = sha256(JSON.stringify({v,drawId,drawSeq,createdAt,userId,userDisplay,identityCommitment,entryIds,entryCount,tickets,receiptHash,deliveryChannel,prevHash}))',
    records: records.map(publicRecord),
  };
}

/** Is this receipt's record intact and linked in its draw chain? (public receipt page) */
export async function checkReceiptInChain(q, drawId, code) {
  const { rows: [draw] } = await q.query('SELECT * FROM draws WHERE id = $1', [drawId]);
  const records = await drawRecords(q, drawId);
  const rec = records.find((r) => r.receiptCode === code);
  if (!rec) return { recordFound: false };
  const recomputed = await computeRecordHash(rec, sha);
  const prev = rec.drawSeq === 1 ? drawGenesis(drawId, draw.seed_commitment) : records.find((r) => r.drawSeq === rec.drawSeq - 1)?.recordHash;
  const seal = draw.sealed_at ? { hash: draw.seal_hash, count: draw.seal_count } : null;
  const whole = await verifyDrawChain({ drawId, seedCommitment: draw.seed_commitment, records, seal }, { sha256: sha });
  return {
    recordFound: true, drawSeq: rec.drawSeq, recordHash: rec.recordHash, recordHashValid: recomputed === rec.recordHash, linkedToPrevious: prev === rec.prevHash,
    chainIntact: whole.ok, sealed: Boolean(seal), sealMatch: whole.sealMatch, sealHash: seal?.hash ?? null, deliveryChannel: rec.deliveryChannel, createdAt: rec.createdAt,
  };
}

export async function queryLedger(db, { drawId, userId, from, to, q, limit = 2000 } = {}) {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (drawId) add('draw_id = ?', Number(drawId));
  if (userId) add('user_id = ?', Number(userId));
  if (from) add('created_at_iso >= ?', new Date(from).toISOString());
  if (to) add('created_at_iso <= ?', new Date(to).toISOString());
  if (q) add('(receipt_code ILIKE ? OR record_hash ILIKE ? OR receipt_hash ILIKE ? OR user_email ILIKE ?)', `%${String(q).trim()}%`);
  const { rows } = await db.query(`SELECT * FROM confirmation_ledger ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 2000, 20000)}`, params);
  return rows.map(fromRow);
}

const csvCell = (v) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const LEDGER_COLUMNS = ['id', 'drawId', 'drawSeq', 'createdAt', 'userId', 'userName', 'userEmail', 'userDisplay', 'identityCommitment', 'identitySalt', 'drawTitle', 'entryIds', 'entryCount', 'tickets', 'receiptCode', 'receiptHash', 'deliveryChannel', 'prevHash', 'recordHash'];
export const PUBLIC_LEDGER_COLUMNS = ['drawId', 'drawSeq', 'createdAt', 'userId', 'userDisplay', 'identityCommitment', 'entryIds', 'entryCount', 'tickets', 'receiptHash', 'deliveryChannel', 'prevHash', 'recordHash'];
export const toCsvLines = (records, columns = LEDGER_COLUMNS) => [columns.join(','), ...records.map((r) => columns.map((c) => csvCell(r[c])).join(','))];
