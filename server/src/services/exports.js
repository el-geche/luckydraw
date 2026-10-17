/**
 * Audit exports (JSON + CSV) of a completed draw. Each export carries a sha256:
 *  - JSON: { exportSha256, content }  where exportSha256 = sha256(JSON.stringify(content))
 *  - CSV : last line "# export_sha256,<hex>" = sha256 of every byte before that line
 */
import { buildSlices } from '@luckydraw/shared';
import { sha256 } from '../util.js';

export const EXPORT_FORMAT = 'luckydraw-audit-export';
export const EXPORT_VERSION = 2;

export function exportContent(audit, extras = {}) {
  const { slices } = buildSlices(audit.entries, audit.mode);
  return {
    format: EXPORT_FORMAT, formatVersion: EXPORT_VERSION,
    algorithm: audit.algorithm, drawId: audit.drawId, title: audit.title, mode: audit.mode, maxEntriesPerUser: audit.maxEntriesPerUser,
    drawnAt: audit.drawnAt, seedDerivation: audit.seedDerivation, serverSeed: audit.serverSeed, commitment: audit.commitment,
    seal: { hash: audit.sealHash, count: audit.sealCount, sealedAt: audit.sealedAt },
    receiptCodes: audit.receiptCodes, crowdEntropy: audit.crowdEntropy, publicEntropy: audit.publicEntropy, publicRandom: audit.publicRandom,
    finalSeed: audit.finalSeed, entriesHash: audit.entriesHash,
    totalWeight: audit.totalWeight, u: audit.u, ticket: audit.ticket,
    winner: audit.winnerEntryId ? { entryId: audit.winnerEntryId, userId: audit.winnerUserId, name: audit.winnerName } : null,
    prizeCents: audit.prizeCents ?? null, simulated: true,
    confirmationTrail: extras.chain ?? null,
    anchors: extras.anchors ?? [],
    entries: slices.map((s, i) => ({ position: i + 1, entryId: s.entryId, userId: s.userId, name: s.name, tickets: s.tickets, weight: s.weight, rangeStart: s.start, rangeEnd: s.end - 1, isWinner: s.entryId === audit.winnerEntryId })),
  };
}

export function buildJsonExport(audit, extras) {
  const content = exportContent(audit, extras);
  const exportSha256 = sha256(JSON.stringify(content));
  return { body: JSON.stringify({ exportSha256, hashAlgorithm: 'sha256(JSON.stringify(content))', content }, null, 2), sha256: exportSha256 };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsvExport(audit, extras) {
  const c = exportContent(audit, extras);
  const meta = [
    ['format', `${c.format} v${c.formatVersion}`], ['notice', 'DEMO - simulated money only'], ['algorithm', c.algorithm],
    ['draw_id', c.drawId], ['title', c.title], ['mode', c.mode], ['max_entries_per_user', c.maxEntriesPerUser], ['drawn_at', c.drawnAt],
    ['seed_derivation', c.seedDerivation], ['server_seed', c.serverSeed], ['commitment', c.commitment],
    ['seal_hash', c.seal.hash], ['seal_count', c.seal.count], ['sealed_at', c.seal.sealedAt],
    ['crowd_entropy', c.crowdEntropy], ['beacon_source', c.publicEntropy?.source], ['beacon_round', c.publicEntropy?.round], ['beacon_value', c.publicEntropy?.value],
    ['public_random', c.publicRandom], ['final_seed', c.finalSeed], ['entries_hash', c.entriesHash], ['total_weight', c.totalWeight], ['u', c.u], ['ticket', c.ticket],
    ['winner_entry_id', c.winner?.entryId ?? ''], ['winner_user_id', c.winner?.userId ?? ''], ['winner_name', c.winner?.name ?? ''], ['prize_cents', c.prizeCents ?? ''],
  ];
  const lines = meta.map(([k, v]) => `# ${k},${csvCell(v)}`);
  lines.push('position,entry_id,user_id,name,tickets,weight,range_start,range_end,is_winner');
  for (const e of c.entries) lines.push([e.position, e.entryId, e.userId, e.name, e.tickets, e.weight, e.rangeStart, e.rangeEnd, e.isWinner].map(csvCell).join(','));
  lines.push('', '# receipt_codes (sorted; crowd entropy input joined by \\n)', 'receipt_code', ...(c.receiptCodes ?? []));
  if (c.confirmationTrail) {
    lines.push('', `# confirmation_trail,genesis=${c.confirmationTrail.genesisHash}`, 'draw_seq,created_at,user_id,user_display,identity_commitment,entry_ids,entry_count,tickets,receipt_hash,delivery_channel,prev_hash,record_hash');
    for (const r of c.confirmationTrail.records) lines.push([r.drawSeq, r.createdAt, r.userId, r.userDisplay, r.identityCommitment, r.entryIds.join(' '), r.entryCount, r.tickets, r.receiptHash, r.deliveryChannel, r.prevHash, r.recordHash].map(csvCell).join(','));
  }
  if (c.anchors?.length) {
    lines.push('', '# anchors (proof_b64 = .ots / .tsr bytes)', 'kind,provider,status,digest,digest_input,submitted_at,bitcoin_block,proof_format,proof_b64');
    for (const a of c.anchors) lines.push([a.kind, a.provider, a.status, a.digest, a.digestInput, a.submittedAt, a.bitcoinBlock, a.proofFormat, a.proofB64].map(csvCell).join(','));
  }
  const body = `${lines.join('\n')}\n`;
  const hash = sha256(body);
  return { body: `${body}# export_sha256,${hash}\n`, sha256: hash };
}
