import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  sha256Hex, hmacSha256Hex, computeCrowdEntropy, crowdEntropyInput, computePublicRandom, computeFinalSeed, deriveSeed,
  verifyAudit, runDraw, verifyDrawChain, computeRecordHash, genesisInput, ALGORITHM, canonicalEntriesJSON,
} from '../src/index.js';

const nodeSha = (b) => createHash('sha256').update(b).digest('hex');

test('pure-JS SHA-256 / HMAC match Node crypto (incl. RFC 4231 vector)', () => {
  for (const s of ['', 'abc', 'x'.repeat(1000), 'héllo ✓']) assert.equal(sha256Hex(s), nodeSha(Buffer.from(s, 'utf8')));
  assert.equal(hmacSha256Hex('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  for (let i = 0; i < 20; i++) {
    const k = randomBytes(1 + i * 7); const m = randomBytes(i * 13);
    assert.equal(hmacSha256Hex(new Uint8Array(k), new Uint8Array(m)), createHmac('sha256', k).update(m).digest('hex'));
  }
});

test('crowd entropy is order-independent and case-normalised; each input changes the seed', () => {
  const codes = ['LD-BBBB-0000-0000-0001', 'ld-aaaa-0000-0000-0002', 'LD-CCCC-0000-0000-0003'];
  assert.equal(crowdEntropyInput(codes), 'LD-AAAA-0000-0000-0002\nLD-BBBB-0000-0000-0001\nLD-CCCC-0000-0000-0003');
  assert.equal(computeCrowdEntropy(codes), computeCrowdEntropy([...codes].reverse()));
  assert.equal(computeCrowdEntropy(codes), nodeSha(crowdEntropyInput(codes)));
  const base = { serverSeed: 'a'.repeat(64), receiptCodes: codes, beaconValue: 'b'.repeat(64), sealHash: 'c'.repeat(64) };
  const s0 = deriveSeed(base).finalSeed;
  assert.notEqual(deriveSeed({ ...base, receiptCodes: codes.slice(1) }).finalSeed, s0);
  assert.notEqual(deriveSeed({ ...base, beaconValue: 'd'.repeat(64) }).finalSeed, s0);
  assert.notEqual(deriveSeed({ ...base, sealHash: 'e'.repeat(64) }).finalSeed, s0);
  assert.notEqual(deriveSeed({ ...base, serverSeed: 'f'.repeat(64) }).finalSeed, s0);
  // Exact byte-level definition
  const ce = computeCrowdEntropy(codes);
  assert.equal(computePublicRandom(ce, 'b'.repeat(64)), nodeSha(Buffer.concat([Buffer.from(ce, 'hex'), Buffer.from('b'.repeat(64), 'hex')])));
  const pr = computePublicRandom(ce, 'b'.repeat(64));
  assert.equal(computeFinalSeed('a'.repeat(64), pr, 'c'.repeat(64)), createHmac('sha256', Buffer.from('a'.repeat(64), 'hex')).update(Buffer.concat([Buffer.from(pr, 'hex'), Buffer.from('c'.repeat(64), 'hex')])).digest('hex'));
});

test('verifyAudit (v3) recomputes every step and flags tampering', async () => {
  const entries = [{ entryId: 1, userId: 1, name: 'A', tickets: 1 }, { entryId: 2, userId: 2, name: 'B', tickets: 1 }, { entryId: 3, userId: 3, name: 'C', tickets: 1 }];
  const serverSeed = randomBytes(32).toString('hex');
  const parts = { serverSeed, receiptCodes: ['LD-1', 'LD-2'], beaconValue: randomBytes(32).toString('hex'), sealHash: randomBytes(32).toString('hex') };
  const d = deriveSeed(parts);
  const r = runDraw({ seed: d.finalSeed, mode: 'equal', entries });
  const audit = { algorithm: ALGORITHM, mode: 'equal', entries, entriesHash: nodeSha(canonicalEntriesJSON(entries)), serverSeed, commitment: d.commitment, receiptCodes: parts.receiptCodes,
    publicEntropy: { source: 'drand', value: parts.beaconValue }, sealHash: parts.sealHash, crowdEntropy: d.crowdEntropy, publicRandom: d.publicRandom, finalSeed: d.finalSeed, winnerEntryId: r.winner.entryId };
  assert.equal((await verifyAudit(audit)).ok, true);
  assert.equal((await verifyAudit({ ...audit, receiptCodes: ['LD-1', 'LD-3'] })).ok, false);
  assert.equal((await verifyAudit({ ...audit, publicEntropy: { value: 'f'.repeat(64) } })).ok, false);
  assert.equal((await verifyAudit({ ...audit, serverSeed: 'f'.repeat(64) })).ok, false);
});

test('per-draw confirmation chain: verifies, and detects edits, deletions, reordering and seal mismatch', async () => {
  const sha = async (s) => sha256Hex(s);
  const commitment = 'ab'.repeat(32);
  let prev = sha256Hex(genesisInput(7, commitment));
  const records = [];
  for (let i = 1; i <= 4; i++) {
    const r = { drawId: 7, drawSeq: i, createdAt: new Date(1e12 + i).toISOString(), userId: i, userDisplay: 'A*** B.', identityCommitment: 'c'.repeat(64), entryIds: [i], entryCount: 1, tickets: 1, receiptHash: 'd'.repeat(64), deliveryChannel: 'demo_outbox', prevHash: prev };
    r.recordHash = await computeRecordHash(r, sha);
    prev = r.recordHash;
    records.push(r);
  }
  const seal = { hash: prev, count: 4 };
  const ok = await verifyDrawChain({ drawId: 7, seedCommitment: commitment, records, seal }, { sha256: sha });
  assert.equal(ok.ok, true); assert.equal(ok.sealMatch, true);
  const edited = records.map((r) => (r.drawSeq === 2 ? { ...r, tickets: 9 } : r));
  const e = await verifyDrawChain({ drawId: 7, seedCommitment: commitment, records: edited, seal }, { sha256: sha });
  assert.equal(e.ok, false); assert.equal(e.sealMatch, false); assert.ok(e.problems.some((p) => p.drawSeq === 2));
  const dropped = await verifyDrawChain({ drawId: 7, seedCommitment: commitment, records: records.filter((r) => r.drawSeq !== 3), seal }, { sha256: sha });
  assert.equal(dropped.ok, false);
  const forged = { ...records[3], tickets: 5 }; forged.recordHash = await computeRecordHash(forged, sha); // re-hashed forgery
  const f = await verifyDrawChain({ drawId: 7, seedCommitment: commitment, records: [...records.slice(0, 3), forged], seal }, { sha256: sha });
  assert.equal(f.sealMatch, false);
  const swapped = await verifyDrawChain({ drawId: 7, seedCommitment: 'ff'.repeat(32), records, seal }, { sha256: sha });
  assert.equal(swapped.ok, false, 'genesis binds the chain to the draw commitment');
});
