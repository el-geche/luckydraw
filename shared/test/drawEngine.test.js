import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  runDraw, enforceEntryCap, canonicalizeEntries, computeOdds, buildSlices, verifyAudit,
  canonicalEntriesJSON, landingAngle, DrawEngineError, ALGORITHM,
} from '../src/index.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const entries = [
  { entryId: 1, userId: 10, name: 'Ava', tickets: 1 },
  { entryId: 2, userId: 11, name: 'Ben', tickets: 3 },
  { entryId: 3, userId: 12, name: 'Chloe', tickets: 1 },
  { entryId: 4, userId: 10, name: 'Ava', tickets: 5 },
  { entryId: 5, userId: 13, name: 'Dan', tickets: 2 },
];

test('reproducible: same seed + entries + mode => identical result', () => {
  const a = runDraw({ seed: 'abc123', mode: 'equal', entries });
  const b = runDraw({ seed: 'abc123', mode: 'equal', entries });
  assert.deepEqual(a, b);
  const c = runDraw({ seed: 'abc123', mode: 'weighted', entries });
  const d = runDraw({ seed: 'abc123', mode: 'weighted', entries });
  assert.deepEqual(c, d);
});

test('reproducible regardless of input order (canonical ordering by entryId)', () => {
  const shuffled = [entries[3], entries[0], entries[4], entries[2], entries[1]];
  for (const seed of ['s1', 's2', 's3', 'deadbeef']) {
    assert.equal(runDraw({ seed, mode: 'weighted', entries }).winner.entryId, runDraw({ seed, mode: 'weighted', entries: shuffled }).winner.entryId);
  }
});

test('known vector: seedrandom ARC4 output is stable', () => {
  const r = runDraw({ seed: 'hello.', mode: 'equal', entries });
  // seedrandom('hello.')() is documented as 0.9282578795792454
  assert.equal(r.u, 0.9282578795792454);
  assert.equal(r.ticket, Math.floor(0.9282578795792454 * 5));
  assert.equal(r.winner.entryId, 5);
});

test('different seeds produce different winners across a sample', () => {
  const winners = new Set();
  for (let i = 0; i < 50; i++) winners.add(runDraw({ seed: `seed-${i}`, mode: 'equal', entries }).winner.entryId);
  assert.ok(winners.size >= 4, `expected variety, got ${[...winners]}`);
});

test('cap enforcement: 5 entries allowed, 6th rejected', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ entryId: i + 1, userId: 1 }));
  assert.doesNotThrow(() => enforceEntryCap(five));
  const six = [...five, { entryId: 6, userId: 1 }];
  assert.throws(() => enforceEntryCap(six), (e) => e instanceof DrawEngineError && e.code === 'ENTRY_CAP_EXCEEDED');
  assert.throws(() => runDraw({ seed: 'x', mode: 'equal', entries: six }), /exceeds the cap/);
  assert.doesNotThrow(() => runDraw({ seed: 'x', mode: 'equal', entries: six, maxEntriesPerUser: 6 }));
});

test('equal mode: one entry = one slice, tickets ignored', () => {
  const { slices, totalWeight } = buildSlices(entries, 'equal');
  assert.equal(totalWeight, 5);
  assert.ok(slices.every((s) => s.weight === 1));
  const odds = computeOdds(entries, 'equal');
  assert.equal(odds.find((o) => o.userId === 10).probability, 2 / 5);
});

test('weighted mode: weight = tickets', () => {
  const { slices, totalWeight } = buildSlices(entries, 'weighted');
  assert.equal(totalWeight, 12);
  assert.deepEqual(slices.map((s) => [s.start, s.end]), [[0, 1], [1, 4], [4, 5], [5, 10], [10, 12]]);
  const odds = computeOdds(entries, 'weighted');
  assert.equal(odds[0].userId, 10);
  assert.equal(odds[0].probability, 6 / 12);
  assert.ok(Math.abs(odds.reduce((s, o) => s + o.probability, 0) - 1) < 1e-12);
});

test('equal vs weighted: empirical frequencies match theoretical odds', () => {
  const N = 20000;
  for (const mode of ['equal', 'weighted']) {
    const counts = new Map();
    for (let i = 0; i < N; i++) {
      const uid = runDraw({ seed: `stat-${i}`, mode, entries }).winner.userId;
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    for (const o of computeOdds(entries, mode)) {
      const observed = (counts.get(o.userId) ?? 0) / N;
      assert.ok(Math.abs(observed - o.probability) < 0.02, `${mode} user ${o.userId}: observed ${observed} vs ${o.probability}`);
    }
  }
});

test('ticket always falls inside the winning slice', () => {
  for (let i = 0; i < 500; i++) {
    const r = runDraw({ seed: `t-${i}`, mode: 'weighted', entries });
    const s = r.slices[r.winnerIndex];
    assert.ok(r.ticket >= s.start && r.ticket < s.end);
    assert.equal(s.entryId, r.winner.entryId);
  }
});

test('input validation', () => {
  assert.throws(() => runDraw({ seed: '', mode: 'equal', entries }), /seed/);
  assert.throws(() => runDraw({ seed: 'x', mode: 'random', entries }), /mode/);
  assert.throws(() => runDraw({ seed: 'x', mode: 'equal', entries: [] }), (e) => e.code === 'NO_ENTRIES');
  assert.throws(() => canonicalizeEntries([{ entryId: 1, userId: 1 }, { entryId: 1, userId: 2 }]), /duplicate/);
  assert.throws(() => canonicalizeEntries([{ entryId: 1, userId: 1, tickets: 11 }]), /tickets/);
});

test('verifyAudit: passes on honest audit, fails on tampering', async () => {
  const seed = 'f'.repeat(64);
  const r = runDraw({ seed, mode: 'weighted', entries });
  const audit = {
    algorithm: ALGORITHM, mode: 'weighted', seed, commitment: sha256(seed),
    entries, entriesHash: sha256(canonicalEntriesJSON(entries)), winnerEntryId: r.winner.entryId,
  };
  assert.equal((await verifyAudit(audit, { sha256 })).ok, true);
  assert.equal((await verifyAudit({ ...audit, commitment: sha256('other') }, { sha256 })).ok, false);
  const otherWinner = entries.find((e) => e.entryId !== r.winner.entryId).entryId;
  assert.equal((await verifyAudit({ ...audit, winnerEntryId: otherWinner }, { sha256 })).ok, false);
  const tampered = entries.map((e) => (e.entryId === 2 ? { ...e, tickets: 4 } : e));
  assert.equal((await verifyAudit({ ...audit, entries: tampered }, { sha256 })).checks.find((c) => c.name.startsWith('Entry list')).ok, false);
});

test('landingAngle puts the ticket centre under the top pointer', () => {
  assert.equal(landingAngle(0, 4), 315);
  assert.equal(landingAngle(3, 4), 45);
});
