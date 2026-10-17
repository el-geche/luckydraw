/**
 * Entry-confirmation audit chain ("luckydraw-ledger-v1"), shared by server and browser.
 * Each draw has its own append-only hash chain of confirmation records:
 *   genesis     = sha256(`luckydraw-ledger-v1|draw:${drawId}|${seedCommitment}`)
 *   recordHash  = sha256(JSON.stringify(hashedFields(record)))
 *   prevHash    = previous record's recordHash (first record: genesis)
 * When the draw closes the server seals { finalHash, count, sealedAt }.
 * `sha256` is injected (Node crypto on the server, WebCrypto in the browser).
 */
export const LEDGER_VERSION = 'luckydraw-ledger-v1';

export const genesisInput = (drawId, seedCommitment) => `${LEDGER_VERSION}|draw:${drawId}|${seedCommitment}`;

/** Exactly the public fields covered by recordHash, in fixed key order. No email or full name. */
export function hashedFields(r) {
  return {
    v: LEDGER_VERSION,
    drawId: r.drawId,
    drawSeq: r.drawSeq,
    createdAt: r.createdAt,
    userId: r.userId,
    userDisplay: r.userDisplay,
    identityCommitment: r.identityCommitment,
    entryIds: r.entryIds,
    entryCount: r.entryCount,
    tickets: r.tickets,
    receiptHash: r.receiptHash,
    deliveryChannel: r.deliveryChannel,
    prevHash: r.prevHash,
  };
}

export const publicRecord = (r) => ({ ...hashedFields(r), recordHash: r.recordHash });

export async function computeRecordHash(r, sha256) {
  return sha256(JSON.stringify(hashedFields(r)));
}

/**
 * Recompute a draw's chain from genesis. Optionally compare with the published seal.
 * @returns {{ok, count, genesis, finalHash, sealMatch, problems, steps}}
 */
export async function verifyDrawChain({ drawId, seedCommitment, records, seal = null }, { sha256 }) {
  const genesis = await sha256(genesisInput(drawId, seedCommitment));
  const problems = [];
  const steps = [];
  let prev = genesis;
  const sorted = [...records].sort((a, b) => a.drawSeq - b.drawSeq);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const issues = [];
    if (r.drawId !== drawId) issues.push('record belongs to another draw');
    if (r.drawSeq !== i + 1) issues.push(`sequence gap (expected ${i + 1})`);
    if (r.prevHash !== prev) issues.push('prevHash does not link to previous record');
    const computed = await computeRecordHash(r, sha256);
    if (computed !== r.recordHash) issues.push('recordHash mismatch — record contents altered');
    steps.push({ drawSeq: r.drawSeq, prevHash: r.prevHash, recordHash: r.recordHash, computed, ok: issues.length === 0 });
    for (const p of issues) problems.push({ drawSeq: r.drawSeq, problem: p });
    prev = computed; // continue from the recomputed hash so later links expose tampering too
  }
  const finalHash = prev;
  let sealMatch = null;
  if (seal) {
    // A seal only matches if every link is intact AND the final hash/count equal the sealed values.
    sealMatch = problems.length === 0 && seal.hash === finalHash && seal.count === sorted.length;
    if (seal.hash !== finalHash) problems.push({ drawSeq: null, problem: 'final hash does not match the sealed hash' });
    if (seal.count !== sorted.length) problems.push({ drawSeq: null, problem: `record count ${sorted.length} ≠ sealed count ${seal.count}` });
  }
  return { ok: problems.length === 0, count: sorted.length, genesis, finalHash, sealMatch, problems, steps };
}
