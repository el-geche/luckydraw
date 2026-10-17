import nodeCrypto from 'node:crypto';
globalThis.__ldNodeCrypto = nodeCrypto;
/**
 * Pluggable external anchoring of draw commitments and seals. Runs in the background:
 * closing/opening a draw only inserts 'pending' rows, so anchoring can never block a draw.
 *
 * Providers
 *  - opentimestamps (default): POST the 32-byte digest to public calendars, store a .ots proof
 *    (pending attestation); "upgrade" later fetches the Bitcoin attestation from the calendar.
 *  - rfc3161 (optional): RFC 3161 TimeStampReq to a TSA (freetsa.org by default), store the .tsr token.
 *  - webhook (optional, off unless ANCHOR_WEBHOOK_URL is set): POST {drawId, kind, digest} JSON.
 * Only hashes ever leave the server.
 */
import { sha256Hex, hexToBytes, toHex } from '@luckydraw/shared';
import { config } from '../config.js';
import { iso } from '../util.js';

const A = () => config.anchors;
let fetchImpl = (url, opts) => fetch(url, opts);
export const setAnchorFetch = (fn) => { fetchImpl = fn; };

// ---------- digests ----------
export const commitmentDigestInput = (draw) => `luckydraw-commitment-v1|draw:${draw.id}|commitment:${draw.seed_commitment}|opensAt:${new Date(draw.opens_at).toISOString()}`;
export const sealDigestInput = (draw) => `luckydraw-seal-v1|draw:${draw.id}|count:${draw.seal_count}|final:${draw.seal_hash}|sealedAt:${new Date(draw.sealed_at).toISOString()}|commitment:${draw.seed_commitment}`;

export async function enqueueAnchors(q, draw, kind, { providers = A().providers } = {}) {
  const input = kind === 'seal' ? sealDigestInput(draw) : commitmentDigestInput(draw);
  const digest = sha256Hex(input);
  for (const p of providers) {
    await q.query(
      `INSERT INTO draw_anchors (draw_id, kind, provider, digest_input, digest) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (draw_id, kind, provider) DO NOTHING`,
      [draw.id, kind, p, input, digest]);
  }
  return { input, digest };
}

// ---------- OpenTimestamps ----------
const OTS_MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
const TAG_PENDING = '83dfe30d2ef90c8e';
const TAG_BITCOIN = '0588960d73d71901';

function readVarUint(buf, pos) {
  let v = 0; let shift = 0; let b;
  do { b = buf[pos.i++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
  return v;
}
const readVarBytes = (buf, pos) => { const n = readVarUint(buf, pos); const out = buf.subarray(pos.i, pos.i + n); pos.i += n; return out; };
const writeVarUint = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };

/** Walk an OTS timestamp, applying ops to `msg`; collect attestations with the commitment they attest. */
export function parseOtsTimestamp(buf, pos, msg, out = []) {
  const crypto = globalThis.__ldNodeCrypto;
  for (;;) {
    let tag = buf[pos.i++];
    let fork = false;
    if (tag === 0xff) { fork = true; tag = buf[pos.i++]; }
    let next;
    if (tag === 0x00) {
      const t = buf.subarray(pos.i, pos.i + 8).toString('hex'); pos.i += 8;
      const payload = readVarBytes(buf, pos);
      const p2 = { i: 0 };
      if (t === TAG_PENDING) out.push({ type: 'pending', uri: readVarBytes(payload, p2).toString('utf8'), commitment: toHex(msg) });
      else if (t === TAG_BITCOIN) out.push({ type: 'bitcoin', height: readVarUint(payload, p2), commitment: toHex(msg) });
      else out.push({ type: 'unknown', tag: t, commitment: toHex(msg) });
      if (!fork) return out;
      continue;
    }
    if (tag === 0xf0) next = Buffer.concat([msg, readVarBytes(buf, pos)]);
    else if (tag === 0xf1) next = Buffer.concat([readVarBytes(buf, pos), msg]);
    else if (tag === 0x08) next = Buffer.from(hexToBytes(sha256Hex(new Uint8Array(msg))));
    else if (tag === 0x02) next = crypto.createHash('sha1').update(msg).digest();
    else if (tag === 0x03) next = crypto.createHash('ripemd160').update(msg).digest();
    else if (tag === 0xf2) next = Buffer.from(msg).reverse();
    else if (tag === 0xf3) next = Buffer.from(msg.toString('hex'));
    else throw new Error(`unsupported OTS op 0x${tag.toString(16)}`);
    if (fork) { parseOtsTimestamp(buf, pos, next, out); continue; }
    msg = next;
  }
}

export function otsFile(digestHex, timestampBuf) {
  return Buffer.concat([OTS_MAGIC, writeVarUint(1), Buffer.from([0x08]), Buffer.from(digestHex, 'hex'), timestampBuf]);
}
export function otsInfo(file) {
  const pos = { i: OTS_MAGIC.length };
  if (!file.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC)) throw new Error('not an OTS proof');
  readVarUint(file, pos);
  if (file[pos.i++] !== 0x08) throw new Error('only sha256 file hashes supported');
  const digest = file.subarray(pos.i, pos.i + 32); pos.i += 32;
  return { digest: digest.toString('hex'), attestations: parseOtsTimestamp(file, pos, Buffer.from(digest)) };
}

const opentimestamps = {
  name: 'opentimestamps',
  async submit(anchor) {
    const body = Buffer.from(anchor.digest, 'hex');
    const parts = []; const errors = []; const calendars = [];
    for (const cal of A().otsCalendars) {
      try {
        const res = await fetchImpl(`${cal.replace(/\/$/, '')}/digest`, { method: 'POST', body, headers: { Accept: 'application/vnd.opentimestamps.v1', 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(A().timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        parts.push(Buffer.from(await res.arrayBuffer())); calendars.push(cal);
      } catch (e) { errors.push(`${cal}: ${e.message}`); }
    }
    if (!parts.length) throw new Error(`no calendar reachable (${errors.join('; ')})`);
    const ts = Buffer.concat(parts.flatMap((p, i) => (i < parts.length - 1 ? [Buffer.from([0xff]), p] : [p])));
    const proof = otsFile(anchor.digest, ts);
    const info = otsInfo(proof);
    return { status: 'submitted', proof, format: 'ots', info: { calendars, errors, attestations: info.attestations } };
  },
  /** Ask each pending calendar for its upgraded (Bitcoin) timestamp. */
  async upgrade(anchor) {
    const proof = Buffer.from(anchor.proof_b64, 'base64');
    const info = otsInfo(proof);
    const pending = info.attestations.filter((a) => a.type === 'pending');
    const upgraded = [];
    for (const p of pending) {
      try {
        const res = await fetchImpl(`${p.uri.replace(/\/$/, '')}/timestamp/${p.commitment}`, { headers: { Accept: 'application/vnd.opentimestamps.v1' }, signal: AbortSignal.timeout(A().timeoutMs) });
        if (res.status === 404) continue; // not yet in a Bitcoin block
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const att = parseOtsTimestamp(buf, { i: 0 }, Buffer.from(p.commitment, 'hex'));
        const btc = att.find((a) => a.type === 'bitcoin');
        if (btc) upgraded.push({ calendar: p.uri, commitment: p.commitment, height: btc.height, timestamp: buf.toString('base64') });
      } catch { /* try later */ }
    }
    if (!upgraded.length) return null;
    // Store the Bitcoin-attested sub-proofs alongside the original proof (the original remains valid).
    return { status: 'confirmed', info: { ...anchor.info, attestations: info.attestations, bitcoin: upgraded.map(({ timestamp, ...rest }) => rest), upgradedTimestamps: upgraded } };
  },
};

// ---------- RFC 3161 ----------
const der = (tag, content) => {
  const len = content.length;
  const l = len < 128 ? Buffer.from([len]) : len < 256 ? Buffer.from([0x81, len]) : Buffer.from([0x82, len >> 8, len & 0xff]);
  return Buffer.concat([Buffer.from([tag]), l, content]);
};
export function timeStampReq(digestHex, nonce) {
  const sha256Oid = Buffer.from('0609608648016503040201', 'hex');
  const algId = der(0x30, Buffer.concat([sha256Oid, Buffer.from([0x05, 0x00])]));
  const imprint = der(0x30, Buffer.concat([algId, der(0x04, Buffer.from(digestHex, 'hex'))]));
  const n = Buffer.from(nonce, 'hex'); const nonceInt = der(0x02, n[0] & 0x80 ? Buffer.concat([Buffer.from([0]), n]) : n);
  return der(0x30, Buffer.concat([der(0x02, Buffer.from([1])), imprint, nonceInt, Buffer.from([0x01, 0x01, 0xff])]));
}
const rfc3161 = {
  name: 'rfc3161',
  async submit(anchor) {
    const nonce = sha256Hex(`${anchor.digest}|${Date.now()}`).slice(0, 16);
    const res = await fetchImpl(A().tsaUrl, { method: 'POST', body: timeStampReq(anchor.digest, nonce), headers: { 'Content-Type': 'application/timestamp-query' }, signal: AbortSignal.timeout(A().timeoutMs) });
    if (!res.ok) throw new Error(`TSA HTTP ${res.status}`);
    const proof = Buffer.from(await res.arrayBuffer());
    if (!proof.includes(Buffer.from(anchor.digest, 'hex'))) throw new Error('TSA response does not contain the submitted digest');
    return { status: 'confirmed', proof, format: 'tsr', info: { tsa: A().tsaUrl, nonce } };
  },
};

// ---------- webhook (off unless configured) ----------
const webhook = {
  name: 'webhook',
  async submit(anchor) {
    if (!A().webhookUrl) throw new Error('ANCHOR_WEBHOOK_URL not configured');
    const res = await fetchImpl(A().webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'luckydraw', drawId: anchor.draw_id, kind: anchor.kind, digest: anchor.digest, digestInput: anchor.digest_input }), signal: AbortSignal.timeout(A().timeoutMs) });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
    return { status: 'confirmed', proof: null, format: null, info: { url: A().webhookUrl.replace(/\/\/([^/]+).*/, '//$1/…') } };
  },
};

const registry = new Map([[opentimestamps.name, opentimestamps], [rfc3161.name, rfc3161], [webhook.name, webhook]]);
export const registerAnchorProvider = (p) => registry.set(p.name, p);

/** Process due pending/failed anchors. Never throws. */
export async function processAnchors(db, now = new Date()) {
  const { rows } = await db.query(`SELECT * FROM draw_anchors WHERE status IN ('pending','failed') AND next_try_at <= $1 ORDER BY id LIMIT 10`, [now]);
  for (const a of rows) {
    const provider = registry.get(a.provider);
    try {
      if (!provider) throw new Error(`unknown provider ${a.provider}`);
      const r = await provider.submit(a);
      await db.query(`UPDATE draw_anchors SET status=$2, proof_b64=$3, proof_format=$4, info=$5::jsonb, submitted_at=$6, updated_at=$6, attempts=attempts+1, last_error=NULL WHERE id=$1`,
        [a.id, r.status, r.proof ? r.proof.toString('base64') : null, r.format, JSON.stringify(r.info ?? {}), now]);
    } catch (e) {
      const backoff = Math.min(A().retryMs * 2 ** Math.min(a.attempts, 6), 6 * 3600_000);
      await db.query(`UPDATE draw_anchors SET status='pending', attempts=attempts+1, last_error=$2, updated_at=$3, next_try_at=$4 WHERE id=$1`, [a.id, String(e.message).slice(0, 500), now, new Date(now.getTime() + backoff)]);
    }
  }
}

/** Try to upgrade submitted OTS proofs to Bitcoin attestations. */
export async function upgradeAnchors(db, { drawId = null, now = new Date() } = {}) {
  const { rows } = await db.query(`SELECT * FROM draw_anchors WHERE status='submitted' ${drawId ? 'AND draw_id = $1' : ''} ORDER BY id`, drawId ? [drawId] : []);
  let upgraded = 0;
  for (const a of rows) {
    const p = registry.get(a.provider);
    if (!p?.upgrade) continue;
    try {
      const r = await p.upgrade(a);
      if (r) { upgraded++; await db.query(`UPDATE draw_anchors SET status=$2, info=$3::jsonb, updated_at=$4 WHERE id=$1`, [a.id, r.status, JSON.stringify(r.info), now]); }
      else await db.query('UPDATE draw_anchors SET updated_at=$2 WHERE id=$1', [a.id, now]);
    } catch { /* later */ }
  }
  return { checked: rows.length, upgraded };
}

export function serializeAnchor(a, { withProof = false } = {}) {
  const btc = a.info?.bitcoin?.[0];
  return {
    id: a.id, drawId: a.draw_id, kind: a.kind, provider: a.provider, status: a.status, digest: a.digest, digestInput: a.digest_input,
    attempts: a.attempts, lastError: a.last_error, proofFormat: a.proof_format, hasProof: Boolean(a.proof_b64),
    submittedAt: iso(a.submitted_at), updatedAt: iso(a.updated_at), createdAt: iso(a.created_at),
    calendars: a.info?.calendars ?? null, bitcoinBlock: btc ? btc.height : null, tsa: a.info?.tsa ?? null,
    proofUrl: a.proof_b64 ? `/api/draws/${a.draw_id}/anchors/${a.id}/proof.${a.proof_format}` : null,
    ...(withProof ? { proofB64: a.proof_b64 } : {}),
  };
}

export async function drawAnchors(q, drawId, opts) {
  const { rows } = await q.query('SELECT * FROM draw_anchors WHERE draw_id = $1 ORDER BY kind, provider', [drawId]);
  return rows.map((a) => serializeAnchor(a, opts));
}
