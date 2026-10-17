/**
 * External public entropy: a drand beacon round chosen at seal time whose value does
 * not exist yet (strictly after the seal). Fetched when the draw runs.
 */
import { config } from '../config.js';
import { HttpError } from '../errors.js';

let fetchImpl = (url, opts) => fetch(url, opts);
export const setEntropyFetch = (fn) => { fetchImpl = fn; };

const c = () => config.entropy;
export const roundTime = (round) => new Date((c().drandGenesis + (round - 1) * c().drandPeriod) * 1000);
/** First round whose time is strictly after `at` + one full period (so it cannot be known at seal). */
export function futureRound(at) {
  const t = Math.floor(new Date(at).getTime() / 1000);
  const current = Math.floor((t - c().drandGenesis) / c().drandPeriod) + 1;
  return current + 2;
}

export function commitEntropy(sealedAt) {
  if (c().provider !== 'drand') return { source: 'none', round: null };
  return { source: 'drand', round: futureRound(sealedAt) };
}

export const beaconUrl = (round) => `${c().drandUrl}/public/${round}`;

export class EntropyPending extends HttpError {
  constructor(round, availableAt) {
    super(409, `Waiting for public entropy: drand round ${round} (available ${availableAt.toISOString()}). The draw will run automatically.`, 'ENTROPY_PENDING', { round, availableAt: availableAt.toISOString() });
  }
}

/** Resolve the committed beacon value. Throws EntropyPending if not yet available. */
export async function resolveEntropy(draw, now = new Date()) {
  if (draw.entropy_source === 'none' || !draw.entropy_round) return { source: draw.entropy_source || 'none', round: null, value: null, url: null };
  if (draw.entropy_value) return { source: draw.entropy_source, round: Number(draw.entropy_round), value: draw.entropy_value, url: beaconUrl(draw.entropy_round) };
  const round = Number(draw.entropy_round);
  const at = roundTime(round);
  if (now < at) throw new EntropyPending(round, at);
  try {
    const res = await fetchImpl(beaconUrl(round), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`drand HTTP ${res.status}`);
    const j = await res.json();
    if (!/^[0-9a-f]{64}$/.test(j.randomness) || Number(j.round) !== round) throw new Error('unexpected drand response');
    return { source: 'drand', round, value: j.randomness, url: beaconUrl(round), signature: j.signature ?? null };
  } catch (e) {
    if (now.getTime() - at.getTime() > c().fallbackAfterMs) {
      return { source: 'drand-unavailable', round, value: null, url: beaconUrl(round), note: `beacon unreachable (${e.message}); drawn without external entropy` };
    }
    throw new EntropyPending(round, new Date(now.getTime() + 15000));
  }
}
