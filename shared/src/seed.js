/**
 * Final RNG seed derivation ("luckydraw-seed-v3").
 *
 *  commitment    = SHA-256(serverSeedBytes)            hex — published at open; serverSeed is 32 random bytes (hex)
 *    (computed over the UTF-8 hex string of serverSeed, i.e. sha256(serverSeedHex))
 *  crowdEntropy  = SHA-256( UTF-8( receiptCodes sorted ascending (byte order), uppercase, joined by "\n" ) )
 *  publicRandom  = SHA-256( bytes(crowdEntropy) || bytes(beaconValue) )      (beacon omitted if unavailable)
 *  finalSeed     = HMAC-SHA256( key = bytes(serverSeed), msg = bytes(publicRandom) || bytes(sealHash) )
 *  rng           = seedrandom(finalSeed hex)
 * where bytes(x) = hex-decoding of a 64-char hex string, and beaconValue is the drand
 * randomness of the round committed at close (its value did not exist at close time).
 */
import { sha256Hex, sha256Bytes, hmacSha256Hex, hexToBytes, concatBytes, utf8, toHex } from './crypto.js';

export const SEED_DERIVATION = 'luckydraw-seed-v3';

export const canonicalReceiptCodes = (codes) => [...codes].map((c) => String(c).trim().toUpperCase()).sort();
export const crowdEntropyInput = (codes) => canonicalReceiptCodes(codes).join('\n');
export const computeCrowdEntropy = (codes) => sha256Hex(utf8(crowdEntropyInput(codes)));

export function computePublicRandom(crowdEntropy, beaconValue) {
  const parts = [hexToBytes(crowdEntropy)];
  if (beaconValue) parts.push(hexToBytes(beaconValue));
  return toHex(sha256Bytes(concatBytes(...parts)));
}

export const computeFinalSeed = (serverSeed, publicRandom, sealHash) =>
  hmacSha256Hex(hexToBytes(serverSeed), concatBytes(hexToBytes(publicRandom), hexToBytes(sealHash)));

/** All derivation steps at once. */
export function deriveSeed({ serverSeed, receiptCodes, beaconValue, sealHash }) {
  const crowdEntropy = computeCrowdEntropy(receiptCodes);
  const publicRandom = computePublicRandom(crowdEntropy, beaconValue);
  const finalSeed = computeFinalSeed(serverSeed, publicRandom, sealHash);
  return { commitment: sha256Hex(serverSeed), crowdEntropy, publicRandom, finalSeed };
}
