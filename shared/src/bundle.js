/**
 * One-click verification of a published draw bundle, in a fixed order:
 *  1. chain      — recompute the per-draw confirmation chain from genesis
 *  2. seal       — final recomputed hash and record count equal the sealed values
 *  3. anchor     — each anchor proof commits to SHA-256(sealDigestInput) and that input names the sealed hash
 *                  (OpenTimestamps 'submitted' = pending Bitcoin confirmation → amber, not failure)
 *  4. commitment — SHA-256(serverSeed) equals the commitment published at open
 *  5. crowd      — crowdEntropy = SHA-256(sorted receipt codes); codes match the chain's record count
 *  6. public     — publicRandom = SHA-256(crowdEntropy ‖ beacon)
 *  7. seed       — finalSeed = HMAC-SHA256(serverSeed, publicRandom ‖ sealHash)
 *  8. winner     — re-run the draw with the shared engine; winner equals the published winner
 * Each step: { key, label, status: 'pass'|'fail'|'pending'|'skip', expected, actual, detail }
 */
import { verifyDrawChain } from './ledger.js';
import { computeCrowdEntropy, computePublicRandom, computeFinalSeed } from './seed.js';
import { sha256Hex, hexToBytes, utf8 } from './crypto.js';
import { runDraw, canonicalEntriesJSON } from './drawEngine.js';

const OTS_MAGIC_HEX = '004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294';

function b64ToBytes(b64) {
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
const bytesHex = (b, start, len) => Array.from(b.subarray(start, start + len), (x) => x.toString(16).padStart(2, '0')).join('');
function containsBytes(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Does this anchor's proof commit to the sealed hash? */
export function checkAnchorProof(anchor, sealHash) {
  const inputOk = anchor.digestInput.includes(`final:${sealHash}`);
  const digestOk = sha256Hex(utf8(anchor.digestInput)) === anchor.digest;
  let proofOk = null;
  if (anchor.proofB64) {
    const p = b64ToBytes(anchor.proofB64);
    if (anchor.proofFormat === 'ots') {
      // header magic, version varuint(1), file-hash op 0x08 (sha256), then the 32-byte digest
      proofOk = bytesHex(p, 0, 31) === OTS_MAGIC_HEX && p[31] === 1 && p[32] === 0x08 && bytesHex(p, 33, 32) === anchor.digest;
    } else {
      proofOk = containsBytes(p, hexToBytes(anchor.digest)); // RFC 3161: messageImprint holds the digest
    }
  }
  return { inputOk, digestOk, proofOk };
}

export async function verifyBundle({ audit, chain, anchors = [] }) {
  const steps = [];
  const add = (key, label, status, expected, actual, detail) => steps.push({ key, label, status, expected, actual, detail });
  const sha = async (s) => sha256Hex(s);

  // 1 + 2: chain and seal
  const seal = chain?.seal ? { hash: chain.seal.hash, count: chain.seal.count } : null;
  const cv = await verifyDrawChain({ drawId: chain.drawId, seedCommitment: chain.seedCommitment, records: chain.records, seal }, { sha256: sha });
  const chainProblems = cv.problems.filter((p) => p.drawSeq != null);
  add('chain', `Audit chain recomputed (${cv.count} records)`, chainProblems.length ? 'fail' : 'pass',
    chainProblems.length ? `record #${chainProblems[0].drawSeq} intact` : `${cv.count} linked records`, chainProblems.length ? chainProblems[0].problem : `${cv.count} linked records`, { genesis: cv.genesis });
  add('seal', 'Sealed final hash matches recomputed chain', !seal ? 'fail' : cv.sealMatch ? 'pass' : 'fail',
    seal ? `${seal.hash} (${seal.count})` : 'a seal', `${cv.finalHash} (${cv.count})`);

  // 3: anchors of the seal
  const sealAnchors = anchors.filter((a) => a.kind === 'seal');
  if (!sealAnchors.length) add('anchor', 'External anchor of the seal', 'skip', 'an anchor', 'none configured');
  for (const a of sealAnchors) {
    const c = checkAnchorProof(a, seal?.hash ?? '');
    const committed = c.inputOk && c.digestOk && c.proofOk === true;
    let status = 'fail';
    if (committed) status = a.status === 'confirmed' ? 'pass' : 'pending';
    else if (!a.proofB64 && (a.status === 'pending' || a.status === 'failed') && c.inputOk && c.digestOk) status = 'pending';
    const label = a.provider === 'opentimestamps'
      ? (a.status === 'confirmed' ? `OpenTimestamps proof — confirmed in Bitcoin block ${a.bitcoinBlock ?? ''}` : committed ? 'OpenTimestamps proof commits to the sealed hash — not yet confirmed on Bitcoin' : 'OpenTimestamps submission pending')
      : `${a.provider} proof commits to the sealed hash`;
    add(`anchor:${a.provider}`, label, status, `proof over sha256(${a.digestInput.slice(0, 40)}…) = ${a.digest}`, c.proofOk === false ? 'proof does not contain this digest' : !c.inputOk ? 'digest input does not name the sealed hash' : !c.digestOk ? 'digest ≠ sha256(input)' : a.digest);
  }

  // 4–7: seed derivation
  const commit = sha256Hex(audit.serverSeed);
  add('commitment', 'SHA-256(serverSeed) equals the commitment published at open', commit === audit.commitment && commit === chain.seedCommitment ? 'pass' : 'fail', audit.commitment, commit);
  const crowd = computeCrowdEntropy(audit.receiptCodes ?? []);
  const codesOk = (audit.receiptCodes ?? []).length === cv.count;
  add('crowd', `Crowd entropy from ${(audit.receiptCodes ?? []).length} receipt codes`, crowd === audit.crowdEntropy && codesOk ? 'pass' : 'fail', audit.crowdEntropy, codesOk ? crowd : `${crowd} (code count ${(audit.receiptCodes ?? []).length} ≠ chain records ${cv.count})`);
  const beacon = audit.publicEntropy?.value || null;
  const pr = computePublicRandom(crowd, beacon);
  add('public', `Public random = SHA-256(crowdEntropy ‖ ${beacon ? `drand round ${audit.publicEntropy.round}` : 'no beacon'})`, pr === audit.publicRandom ? 'pass' : 'fail', audit.publicRandom, pr);
  const fs = computeFinalSeed(audit.serverSeed, pr, seal?.hash ?? audit.sealHash);
  add('seed', 'Final seed = HMAC-SHA256(serverSeed, publicRandom ‖ sealHash)', fs === audit.finalSeed && audit.sealHash === seal?.hash ? 'pass' : 'fail', audit.finalSeed, fs);

  // 8: winner
  const entriesHash = sha256Hex(canonicalEntriesJSON(audit.entries));
  let result = null;
  try {
    result = runDraw({ seed: fs, mode: audit.mode, entries: audit.entries, maxEntriesPerUser: audit.maxEntriesPerUser });
    const ok = entriesHash === audit.entriesHash && result.winner.entryId === Number(audit.winnerEntryId);
    add('winner', 'Re-run draw selects the published winner', ok ? 'pass' : 'fail',
      `entry #${audit.winnerEntryId}${entriesHash !== audit.entriesHash ? ` / entries hash ${audit.entriesHash}` : ''}`, `entry #${result.winner.entryId}${entriesHash !== audit.entriesHash ? ` / entries hash ${entriesHash}` : ''}`);
  } catch (e) {
    add('winner', 'Re-run draw selects the published winner', 'fail', `entry #${audit.winnerEntryId}`, e.message);
  }

  const firstFail = steps.find((s) => s.status === 'fail') ?? null;
  const verdict = firstFail ? 'fail' : steps.some((s) => s.status === 'pending') ? 'pending' : 'pass';
  return { verdict, steps, firstFail, result, derived: { crowdEntropy: crowd, publicRandom: pr, finalSeed: fs, chainFinalHash: cv.finalHash } };
}
