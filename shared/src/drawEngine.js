/**
 * LuckyDraw draw engine — shared verbatim between the server (which runs the
 * official draw) and the browser (which re-runs it on the public verification
 * page). It is pure and deterministic: same seed + same entry list + same mode
 * always yields the same winner, on any machine.
 *
 * Algorithm "luckydraw-v1"
 *  1. Canonicalise entries: sort ascending by entryId (integer).
 *  2. Weight each entry:  equal mode    -> weight = 1 (one entry = one slice)
 *                          weighted mode -> weight = tickets (integer 1..10)
 *  3. totalWeight W = sum of weights. Lay entries out as contiguous ticket
 *     ranges [start, start + weight) in canonical order.
 *  4. rng = seedrandom(seed)  (ARC4-based PRNG, seedrandom v3 default)
 *     u   = rng()              (first output, 0 <= u < 1)
 *  5. ticket = floor(u * W). The winner is the entry whose range contains ticket.
 */
import seedrandom from 'seedrandom';
import { deriveSeed, SEED_DERIVATION } from './seed.js';
import { sha256Hex } from './crypto.js';

export const ALGORITHM = 'luckydraw-v1';
export const MAX_ENTRIES_PER_USER = 5;
export const MAX_TICKETS_PER_ENTRY = 10;
export const DRAW_MODES = Object.freeze(['equal', 'weighted']);

export class DrawEngineError extends Error {
  constructor(message, code = 'DRAW_ENGINE_ERROR') {
    super(message);
    this.name = 'DrawEngineError';
    this.code = code;
  }
}

function assertInt(value, label, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DrawEngineError(`${label} must be an integer between ${min} and ${max} (got ${value})`, 'INVALID_INPUT');
  }
}

/** Normalise and sort entries into the canonical, published order. */
export function canonicalizeEntries(entries) {
  if (!Array.isArray(entries)) throw new DrawEngineError('entries must be an array', 'INVALID_INPUT');
  const seen = new Set();
  const out = entries.map((e) => {
    const entryId = Number(e.entryId ?? e.id);
    const userId = Number(e.userId ?? e.user_id);
    const tickets = Number(e.tickets ?? 1);
    assertInt(entryId, 'entryId');
    assertInt(userId, 'userId');
    assertInt(tickets, 'tickets', 1, MAX_TICKETS_PER_ENTRY);
    if (seen.has(entryId)) throw new DrawEngineError(`duplicate entryId ${entryId}`, 'INVALID_INPUT');
    seen.add(entryId);
    return { entryId, userId, name: String(e.name ?? e.displayName ?? `User ${userId}`), tickets };
  });
  out.sort((a, b) => a.entryId - b.entryId);
  return out;
}

/** Throws if any participant holds more than `cap` entries in the draw. */
export function enforceEntryCap(entries, cap = MAX_ENTRIES_PER_USER) {
  const counts = new Map();
  for (const e of entries) {
    const uid = Number(e.userId ?? e.user_id);
    const n = (counts.get(uid) ?? 0) + 1;
    if (n > cap) {
      throw new DrawEngineError(`user ${uid} exceeds the cap of ${cap} entries per draw`, 'ENTRY_CAP_EXCEEDED');
    }
    counts.set(uid, n);
  }
  return counts;
}

export function weightOf(entry, mode) {
  if (mode === 'equal') return 1;
  if (mode === 'weighted') return entry.tickets;
  throw new DrawEngineError(`unknown mode "${mode}"`, 'INVALID_INPUT');
}

/** Ticket ranges for each entry (used by both the draw and the wheel). */
export function buildSlices(entries, mode) {
  const canonical = canonicalizeEntries(entries);
  let cursor = 0;
  const slices = canonical.map((e) => {
    const weight = weightOf(e, mode);
    const slice = { ...e, weight, start: cursor, end: cursor + weight };
    cursor += weight;
    return slice;
  });
  return { slices, totalWeight: cursor };
}

/** Per-participant odds breakdown. */
export function computeOdds(entries, mode) {
  const { slices, totalWeight } = buildSlices(entries, mode);
  const byUser = new Map();
  for (const s of slices) {
    const row = byUser.get(s.userId) ?? { userId: s.userId, name: s.name, entries: 0, tickets: 0, weight: 0 };
    row.entries += 1;
    row.tickets += s.tickets;
    row.weight += s.weight;
    byUser.set(s.userId, row);
  }
  return [...byUser.values()]
    .map((r) => ({ ...r, probability: totalWeight ? r.weight / totalWeight : 0 }))
    .sort((a, b) => b.weight - a.weight || a.userId - b.userId);
}

/**
 * Run a draw. Returns the full, auditable result.
 * @param {{seed: string, mode: 'equal'|'weighted', entries: Array, maxEntriesPerUser?: number}} input
 */
export function runDraw({ seed, mode, entries, maxEntriesPerUser = MAX_ENTRIES_PER_USER }) {
  if (typeof seed !== 'string' || seed.length === 0) throw new DrawEngineError('seed must be a non-empty string', 'INVALID_INPUT');
  if (!DRAW_MODES.includes(mode)) throw new DrawEngineError(`unknown mode "${mode}"`, 'INVALID_INPUT');
  const { slices, totalWeight } = buildSlices(entries, mode);
  if (slices.length === 0) throw new DrawEngineError('cannot draw with zero entries', 'NO_ENTRIES');
  enforceEntryCap(slices, maxEntriesPerUser);

  const rng = seedrandom(seed);
  const u = rng();
  const ticket = Math.floor(u * totalWeight);
  // Binary search for the slice containing `ticket`.
  let lo = 0;
  let hi = slices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slices[mid].end <= ticket) lo = mid + 1;
    else hi = mid;
  }
  const winner = slices[lo];
  return {
    algorithm: ALGORITHM,
    mode,
    seed,
    totalWeight,
    u,
    ticket,
    winnerIndex: lo,
    winner: { entryId: winner.entryId, userId: winner.userId, name: winner.name, tickets: winner.tickets, weight: winner.weight },
    slices,
    odds: computeOdds(slices, mode),
  };
}

/** Deterministic JSON of the entry list, used for the published entries hash. */
export function canonicalEntriesJSON(entries) {
  return JSON.stringify(
    canonicalizeEntries(entries).map((e) => ({ entryId: e.entryId, userId: e.userId, tickets: e.tickets }))
  );
}

/**
 * Verify a published audit record. `sha256` is an (async or sync) function
 * string -> hex digest, supplied by the environment (Node crypto / WebCrypto).
 */
export async function verifyAudit(audit, { sha256 = sha256Hex } = {}) {
  const checks = [];
  let seed = audit.seed;
  let derivation = null;
  if (audit.serverSeed) {
    // v3 audits publish serverSeed and every derivation input; the RNG seed is recomputed, never trusted.
    derivation = deriveSeed({ serverSeed: audit.serverSeed, receiptCodes: audit.receiptCodes ?? [], beaconValue: audit.publicEntropy?.value || null, sealHash: audit.sealHash });
    const step = (name, expected, actual) => checks.push({ name, ok: expected === actual, expected, actual });
    step('Commitment: SHA-256(serverSeed) equals the commitment published at open', audit.commitment, derivation.commitment);
    if (audit.crowdEntropy) step('Crowd entropy: SHA-256 of the sorted receipt codes', audit.crowdEntropy, derivation.crowdEntropy);
    if (audit.publicRandom) step('Public random: SHA-256(crowdEntropy ‖ beacon value)', audit.publicRandom, derivation.publicRandom);
    step(`Final seed: HMAC-SHA256(serverSeed, publicRandom ‖ sealHash) [${SEED_DERIVATION}]`, audit.finalSeed ?? derivation.finalSeed, derivation.finalSeed);
    seed = derivation.finalSeed;
  } else if (audit.commitment) {
    const digest = await sha256(audit.seed);
    checks.push({ name: 'Seed matches pre-published commitment', ok: digest === audit.commitment, expected: audit.commitment, actual: digest });
  }
  const result = runDraw({ seed, mode: audit.mode, entries: audit.entries, maxEntriesPerUser: audit.maxEntriesPerUser ?? MAX_ENTRIES_PER_USER });
  if (audit.entriesHash) {
    const digest = await sha256(canonicalEntriesJSON(audit.entries));
    checks.push({ name: 'Entry list matches published entries hash', ok: digest === audit.entriesHash, expected: audit.entriesHash, actual: digest });
  }
  if (audit.algorithm) checks.push({ name: 'Algorithm version', ok: audit.algorithm === ALGORITHM, expected: audit.algorithm, actual: ALGORITHM });
  if (audit.winnerEntryId != null) {
    checks.push({ name: 'Winner: re-running the draw selects the published winner', ok: result.winner.entryId === Number(audit.winnerEntryId), expected: Number(audit.winnerEntryId), actual: result.winner.entryId });
  }
  return { ok: checks.every((c) => c.ok), checks, result, finalSeed: seed, derivation };
}

/** Wheel geometry helper: the rotation (deg) that brings `ticket` under a top pointer. */
export function landingAngle(ticket, totalWeight) {
  const centre = ((ticket + 0.5) / totalWeight) * 360;
  return (360 - centre) % 360;
}
