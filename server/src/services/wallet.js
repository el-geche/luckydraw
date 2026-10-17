import { badRequest } from '../errors.js';

/** All wallet money is SIMULATED. Balance is derived from the ledger. */
export async function getBalance(q, userId) {
  const { rows } = await q.query('SELECT COALESCE(SUM(amount_cents), 0)::int AS balance FROM wallet_transactions WHERE user_id = $1', [userId]);
  return rows[0].balance;
}

export async function addTransaction(q, { userId, type, amountCents, description, drawId = null, provider = 'simulated', providerRef = null, now = new Date() }) {
  const { rows } = await q.query(
    `INSERT INTO wallet_transactions (user_id, type, amount_cents, description, draw_id, provider, provider_ref, simulated, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8) RETURNING *`,
    [userId, type, amountCents, description, drawId, provider, providerRef, now]
  );
  return rows[0];
}

export const MAX_DEMO_DEPOSIT_CENTS = 100000;

export function validateDepositAmount(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > MAX_DEMO_DEPOSIT_CENTS) {
    throw badRequest('Demo deposits must be between $1.00 and $1,000.00 (simulated).', 'INVALID_AMOUNT');
  }
}

export function serializeTx(t) {
  return {
    id: t.id, type: t.type, amountCents: t.amount_cents, description: t.description, drawId: t.draw_id,
    provider: t.provider, providerRef: t.provider_ref, simulated: t.simulated, createdAt: new Date(t.created_at).toISOString(),
  };
}
