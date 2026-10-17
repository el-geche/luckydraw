import {
  runDraw, computeOdds, buildSlices, canonicalEntriesJSON, landingAngle,
  ALGORITHM, MAX_ENTRIES_PER_USER, MAX_TICKETS_PER_ENTRY, DRAW_MODES,
} from '@luckydraw/shared';
import { badRequest, conflict, notFound } from '../errors.js';
import { sha256, newSeed, publicName, iso } from '../util.js';
import { addTransaction, getBalance } from './wallet.js';
import { logEvent } from './logs.js';
import { createReceipt } from './receipts.js';
import { appendConfirmation, computeSeal } from './ledger.js';
import { commitEntropy, resolveEntropy, EntropyPending, beaconUrl, roundTime } from './entropy.js';
import { enqueueAnchors } from './anchors.js';
import { deriveSeed, computeCrowdEntropy, canonicalReceiptCodes, SEED_DERIVATION } from '@luckydraw/shared';

export const AUTO_DRAW_SETTLE_MS = 8000;
const fmt = (c) => `$${(c / 100).toFixed(2)}`;

export async function createDraw(q, input, { actor = 'system', actorId = null, now = new Date(), seed = newSeed(), scheduled = false } = {}) {
  const title = String(input.title || '').trim();
  const mode = input.mode;
  const prizeCents = Number(input.prizeCents);
  const entryPriceCents = Number(input.entryPriceCents ?? 0);
  const maxEntriesPerUser = Number(input.maxEntriesPerUser ?? MAX_ENTRIES_PER_USER);
  const opensAt = input.opensAt ? new Date(input.opensAt) : now;
  const closesAt = input.closesAt ? new Date(input.closesAt) : new Date(now.getTime() + Number(input.durationMinutes ?? 60) * 60000);
  if (title.length < 3 || title.length > 80) throw badRequest('Title must be 3–80 characters');
  if (!DRAW_MODES.includes(mode)) throw badRequest('Mode must be "equal" or "weighted"');
  if (!Number.isInteger(prizeCents) || prizeCents < 0 || prizeCents > 10_000_000) throw badRequest('Invalid prize amount');
  if (!Number.isInteger(entryPriceCents) || entryPriceCents < 0 || entryPriceCents > 100_000) throw badRequest('Invalid entry price');
  if (!Number.isInteger(maxEntriesPerUser) || maxEntriesPerUser < 1 || maxEntriesPerUser > MAX_ENTRIES_PER_USER) throw badRequest(`Entry cap must be 1–${MAX_ENTRIES_PER_USER}`);
  if (Number.isNaN(closesAt.getTime()) || closesAt <= opensAt) throw badRequest('Closing time must be after opening time');

  const commitment = sha256(seed);
  const { rows } = await q.query(
    `INSERT INTO draws (title, description, mode, status, prize_cents, entry_price_cents, max_entries_per_user, auto_draw,
                        seed, seed_commitment, opens_at, closes_at, created_by, created_at)
     VALUES ($1,$2,$3,$14,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [title, String(input.description || ''), mode, prizeCents, entryPriceCents, maxEntriesPerUser, Boolean(input.autoDraw), seed, commitment, opensAt, closesAt, actorId, now, scheduled ? 'scheduled' : 'open']
  );
  const draw = rows[0];
  if (scheduled) {
    await logEvent(q, { drawId: draw.id, event: 'draw_scheduled', actor, now, details: { opensAt: iso(opensAt), closesAt: iso(closesAt), note: 'seed generated and sealed server-side; commitment published at opening' } });
    return draw;
  }
  return openDraw(q, draw, { actor, now: opensAt < now ? now : opensAt, logAt: opensAt });
}

/** Publish the commitment (and anchor it). Seed itself stays server-side. */
export async function openDraw(q, draw, { actor = 'system', now = new Date(), logAt } = {}) {
  if (draw.status === 'scheduled') {
    const { rows } = await q.query(`UPDATE draws SET status='open' WHERE id=$1 RETURNING *`, [draw.id]);
    draw = rows[0];
  }
  const commitment = draw.seed_commitment;
  const opensAt = logAt ?? now;
  const closesAt = draw.closes_at;
  await enqueueAnchors(q, draw, 'commitment');
  await logEvent(q, { drawId: draw.id, event: 'draw_opened', actor, now: opensAt, details: { mode: draw.mode, commitment, closesAt: iso(closesAt), note: 'sha256(seed) committed; seed sealed until draw' } });
  return draw;
}

async function lockDraw(q, drawId) {
  const { rows } = await q.query('SELECT * FROM draws WHERE id = $1 FOR UPDATE', [drawId]);
  if (!rows[0]) throw notFound('Draw not found');
  return rows[0];
}

/**
 * Buy `count` entries for a user. The per-person cap is enforced here, inside a
 * transaction holding a row lock on the draw, so concurrent requests cannot exceed it.
 */
export async function enterDraw(db, { drawId, userId, count = 1, tickets = 1, now = new Date() }) {
  count = Number(count);
  tickets = Number(tickets);
  if (!Number.isInteger(count) || count < 1) throw badRequest('Entry count must be a positive integer');
  return db.tx(async (q) => {
    const draw = await lockDraw(q, drawId);
    if (draw.status !== 'open' || new Date(draw.closes_at) <= now) throw conflict('This draw is closed to new entries', 'DRAW_CLOSED');
    if (draw.mode === 'equal') tickets = 1;
    if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS_PER_ENTRY) throw badRequest(`Tickets per entry must be 1–${MAX_TICKETS_PER_ENTRY}`);
    const { rows: [{ n }] } = await q.query('SELECT COUNT(*)::int AS n FROM entries WHERE draw_id = $1 AND user_id = $2', [drawId, userId]);
    const cap = draw.max_entries_per_user;
    if (n + count > cap) {
      throw conflict(`Entry limit reached: max ${cap} entries per person in this draw (you have ${n}).`, 'ENTRY_CAP_EXCEEDED', { cap, current: n, remaining: Math.max(0, cap - n) });
    }
    const cost = draw.entry_price_cents * tickets * count;
    const balance = await getBalance(q, userId);
    if (cost > balance) throw conflict(`Insufficient demo balance: need ${fmt(cost)}, have ${fmt(balance)}.`, 'INSUFFICIENT_FUNDS');
    const created = [];
    for (let i = 0; i < count; i++) {
      const { rows } = await q.query('INSERT INTO entries (draw_id, user_id, tickets, created_at) VALUES ($1,$2,$3,$4) RETURNING *', [drawId, userId, tickets, now]);
      created.push(rows[0]);
    }
    if (cost > 0) {
      await addTransaction(q, { userId, type: 'entry_fee', amountCents: -cost, drawId, now, description: `${count} entr${count === 1 ? 'y' : 'ies'}${draw.mode === 'weighted' ? ` × ${tickets} ticket${tickets === 1 ? '' : 's'}` : ''} — ${draw.title}` });
    }
    const receipt = await createReceipt(q, { draw, userId, entryIds: created.map((e) => e.id), tickets, costCents: cost, now });
    const { rows: [user] } = await q.query('SELECT id, name, email FROM users WHERE id = $1', [userId]);
    const record = await appendConfirmation(q, { draw, user, receipt, now }); // same tx: chain can never miss an entry
    await logEvent(q, { drawId, event: 'entries_added', actor: `user:${userId}`, now, details: { userId, entryIds: created.map((e) => e.id), tickets, costCents: cost, receipt: receipt.code } });
    return { entries: created, receipt, record, costCents: cost, balanceCents: balance - cost, remaining: cap - n - count };
  });
}

/** Close + seal in one transaction (draw row locked, so no confirmation can slip in after the seal). */
async function closeAndSeal(q, draw, { actor, now }) {
  const seal = await computeSeal(q, draw);
  const entropy = commitEntropy(now);
  const { rows } = await q.query(
    `UPDATE draws SET status='closed', closed_at=$2, seal_hash=$3, seal_count=$4, sealed_at=$2, entropy_source=$5, entropy_round=$6 WHERE id=$1 RETURNING *`,
    [draw.id, now, seal.hash, seal.count, entropy.source, entropy.round]);
  const sealed = rows[0];
  const anchor = await enqueueAnchors(q, sealed, 'seal');
  await logEvent(q, { drawId: draw.id, event: 'draw_closed', actor, now, details: { early: new Date(draw.closes_at) > now } });
  await logEvent(q, { drawId: draw.id, event: 'draw_sealed', actor, now, details: { sealHash: seal.hash, records: seal.count, entropy, anchorDigest: anchor.digest } });
  return sealed;
}

export async function closeDraw(db, drawId, { actor = 'system', now = new Date() } = {}) {
  return db.tx(async (q) => {
    const draw = await lockDraw(q, drawId);
    if (draw.status !== 'open') throw conflict(`Draw is already ${draw.status}`, 'INVALID_STATE');
    return closeAndSeal(q, draw, { actor, now });
  });
}

async function loadEntries(q, drawId) {
  const { rows } = await q.query(
    `SELECT e.id, e.user_id, e.tickets, e.created_at, u.name FROM entries e JOIN users u ON u.id = e.user_id
     WHERE e.draw_id = $1 ORDER BY e.id ASC`, [drawId]);
  return rows.map((r) => ({ entryId: r.id, userId: r.user_id, name: publicName(r.name), tickets: r.tickets, createdAt: iso(r.created_at) }));
}

/**
 * Execute a closed + sealed draw. Final seed (luckydraw-seed-v3):
 *   finalSeed = HMAC-SHA256(serverSeed, SHA-256(crowdEntropy || drandValue) || sealHash)
 * If the committed drand round is not yet available, throws EntropyPending (409) and
 * records the run request; the scheduler completes it as soon as the beacon exists.
 */
export async function executeDraw(db, drawId, { actor = 'system', now = new Date(), entropyNow } = {}) {
  let draw = await getDrawRow(db, drawId);
  if (draw.status === 'drawn' || draw.status === 'void') throw conflict('This draw has already been completed', 'INVALID_STATE');
  if (draw.status === 'open') draw = await closeDraw(db, drawId, { actor, now });
  let entropy;
  try {
    entropy = await resolveEntropy(draw, entropyNow ?? now);
  } catch (e) {
    if (e instanceof EntropyPending && !draw.run_requested) {
      await db.query('UPDATE draws SET run_requested = true WHERE id = $1', [drawId]);
      await logEvent(db, { drawId, event: 'draw_requested', actor, now, details: { waitingFor: `drand round ${draw.entropy_round}` } });
    }
    throw e;
  }
  return db.tx(async (q) => {
    draw = await lockDraw(q, drawId);
    if (draw.status !== 'closed' || !draw.sealed_at) throw conflict('Draw must be closed and sealed before it can be run', 'INVALID_STATE');
    if (entropy.value) await q.query('UPDATE draws SET entropy_value = $2 WHERE id = $1', [drawId, entropy.value]);
    const entries = await loadEntries(q, drawId);
    const entryList = entries.map(({ entryId, userId, name, tickets }) => ({ entryId, userId, name, tickets }));
    const { rows: rc } = await q.query('SELECT code FROM entry_receipts WHERE draw_id = $1', [drawId]);
    const receiptCodes = canonicalReceiptCodes(rc.map((r) => r.code));
    const derived = deriveSeed({ serverSeed: draw.seed, receiptCodes, beaconValue: entropy.value, sealHash: draw.seal_hash });
    const base = {
      drawId: draw.id, title: draw.title, algorithm: ALGORITHM, seedDerivation: SEED_DERIVATION, mode: draw.mode, maxEntriesPerUser: draw.max_entries_per_user,
      serverSeed: draw.seed, commitment: draw.seed_commitment,
      sealHash: draw.seal_hash, sealCount: draw.seal_count, sealedAt: iso(draw.sealed_at),
      receiptCodes, crowdEntropy: derived.crowdEntropy,
      publicEntropy: { source: entropy.source, round: entropy.round, value: entropy.value, url: entropy.url, ...(entropy.note ? { note: entropy.note } : {}) },
      publicRandom: derived.publicRandom, finalSeed: derived.finalSeed, seed: derived.finalSeed,
      entriesHash: sha256(canonicalEntriesJSON(entryList)), entries: entryList, drawnAt: now.toISOString(),
    };
    if (entries.length === 0) {
      const audit = { ...base, totalWeight: 0, u: null, ticket: null, winnerEntryId: null, winnerUserId: null, winnerName: null, note: 'No entries — draw void, seed revealed.' };
      await q.query(`UPDATE draws SET status='void', drawn_at=$2, result=$3::jsonb WHERE id=$1`, [drawId, now, JSON.stringify(audit)]);
      await logEvent(q, { drawId, event: 'draw_void', actor, now, details: { reason: 'no entries', serverSeed: draw.seed } });
      return { draw: { ...draw, status: 'void' }, audit };
    }
    const r = runDraw({ seed: derived.finalSeed, mode: draw.mode, entries: entryList, maxEntriesPerUser: draw.max_entries_per_user });
    const { rows: [winRc] } = await q.query('SELECT code FROM entry_receipts WHERE draw_id = $1 AND $2 = ANY(entry_ids)', [drawId, r.winner.entryId]);
    const audit = { ...base, totalWeight: r.totalWeight, u: r.u, ticket: r.ticket, winnerIndex: r.winnerIndex, winnerEntryId: r.winner.entryId, winnerUserId: r.winner.userId, winnerName: r.winner.name, winnerReceiptCode: winRc?.code ?? null, prizeCents: draw.prize_cents };
    const { rows } = await q.query(
      `UPDATE draws SET status='drawn', drawn_at=$2, winner_entry_id=$3, winner_user_id=$4, result=$5::jsonb WHERE id=$1 RETURNING *`,
      [drawId, now, r.winner.entryId, r.winner.userId, JSON.stringify(audit)]);
    if (draw.prize_cents > 0) {
      await addTransaction(q, { userId: r.winner.userId, type: 'prize_payout', amountCents: draw.prize_cents, drawId, now, description: `Prize payout — ${draw.title}` });
    }
    await logEvent(q, { drawId, event: 'draw_executed', actor, now, details: { serverSeed: draw.seed, commitment: draw.seed_commitment, sealHash: draw.seal_hash, crowdEntropy: derived.crowdEntropy, entropy: base.publicEntropy, publicRandom: derived.publicRandom, finalSeed: derived.finalSeed, ticket: r.ticket, winnerEntryId: r.winner.entryId } });
    if (draw.prize_cents > 0) await logEvent(q, { drawId, event: 'prize_paid', actor: 'system', now, details: { userId: r.winner.userId, amountCents: draw.prize_cents, simulated: true } });
    return { draw: rows[0], audit };
  });
}

/** Public representation. Seed is only included once revealed (drawn/void). */
export async function serializeDraw(q, draw, { includeEntries = false, viewerId = null, admin = false } = {}) {
  const revealed = draw.status === 'drawn' || draw.status === 'void';
  const { rows: [stats] } = await q.query(
    'SELECT COUNT(*)::int AS entries, COUNT(DISTINCT user_id)::int AS participants, COALESCE(SUM(tickets),0)::int AS tickets FROM entries WHERE draw_id = $1', [draw.id]);
  const out = {
    id: draw.id, title: draw.title, description: draw.description, mode: draw.mode, status: draw.status,
    prizeCents: draw.prize_cents, entryPriceCents: draw.entry_price_cents, maxEntriesPerUser: draw.max_entries_per_user,
    autoDraw: draw.auto_draw, seedCommitment: draw.status === 'scheduled' ? null : draw.seed_commitment, seed: revealed ? draw.seed : null, // serverSeed: never before the draw is sealed AND run
    opensAt: iso(draw.opens_at), closesAt: iso(draw.closes_at), closedAt: iso(draw.closed_at), drawnAt: iso(draw.drawn_at),
    stats, winner: null,
    seal: draw.sealed_at ? { hash: draw.seal_hash, count: draw.seal_count, sealedAt: iso(draw.sealed_at) } : null,
    entropy: draw.entropy_source ? { source: draw.entropy_source, round: draw.entropy_round == null ? null : Number(draw.entropy_round), value: revealed ? draw.entropy_value : null, url: draw.entropy_round ? beaconUrl(draw.entropy_round) : null, availableAt: draw.entropy_round ? roundTime(Number(draw.entropy_round)).toISOString() : null } : null,
    runRequested: Boolean(draw.run_requested),
    announcementVisibility: draw.announcement_visibility,
  };
  if (revealed && draw.result) {
    out.winner = draw.result.winnerEntryId ? { entryId: draw.result.winnerEntryId, userId: draw.result.winnerUserId, name: draw.result.winnerName } : null;
  }
  if (includeEntries) {
    const entries = await loadEntries(q, draw.id);
    out.entries = entries;
    if (entries.length) {
      const { slices, totalWeight } = buildSlices(entries, draw.mode);
      out.slices = slices.map(({ entryId, userId, name, tickets, weight, start, end }) => ({ entryId, userId, name, tickets, weight, start, end }));
      out.totalWeight = totalWeight;
      out.odds = computeOdds(entries, draw.mode);
    } else {
      out.slices = []; out.totalWeight = 0; out.odds = [];
    }
    if (revealed && draw.result?.ticket != null) {
      out.result = { ...draw.result, landingAngle: landingAngle(draw.result.ticket, draw.result.totalWeight) };
    }
    if (viewerId) out.myEntries = entries.filter((e) => e.userId === viewerId);
  }
  if (admin) out.sealedSeedAvailable = !revealed;
  return out;
}

export async function getDrawRow(q, id) {
  const { rows } = await q.query('SELECT * FROM draws WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Draw not found');
  return rows[0];
}

/** Scheduler: close expired draws, then execute auto-draws. */
export async function tick(db, now = new Date()) {
  const { rows: opening } = await db.query(`SELECT id FROM draws WHERE status='scheduled' AND opens_at <= $1`, [now]);
  for (const { id } of opening) {
    try { await db.tx(async (q) => { const d = await lockDraw(q, id); if (d.status === 'scheduled') await openDraw(q, d, { actor: 'scheduler', now }); }); } catch { /* raced */ }
  }
  const { rows: expired } = await db.query(`SELECT id FROM draws WHERE status='open' AND closes_at <= $1`, [now]);
  for (const { id } of expired) {
    try { await closeDraw(db, id, { actor: 'scheduler', now }); } catch { /* raced */ }
  }
  // Auto-draws stay visibly "closed" for a short settling period before the wheel spins.
  const settle = new Date(now.getTime() - AUTO_DRAW_SETTLE_MS);
  const { rows: due } = await db.query(`SELECT id FROM draws WHERE status='closed' AND (auto_draw = true OR run_requested = true) AND closed_at <= $1`, [settle]);
  const done = [];
  for (const { id } of due) {
    try { const r = await executeDraw(db, id, { actor: 'scheduler', now }); done.push(r); } catch { /* pending entropy or raced */ }
  }
  return done;
}
