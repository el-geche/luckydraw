/**
 * Demo payments layer. NO REAL MONEY.
 *  - "simulated" (default): instantly approves, no network calls.
 *  - "stripe-test": optional stub that creates + confirms a Stripe *test-mode*
 *    PaymentIntent with the test card pm_card_visa. Refuses any non sk_test_ key.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { badRequest } from '../errors.js';

const simulated = {
  name: 'simulated',
  async charge({ amountCents }) {
    return { ok: true, provider: 'simulated', ref: `sim_${crypto.randomBytes(6).toString('hex')}`, amountCents };
  },
};

const stripeTest = {
  name: 'stripe-test',
  async charge({ amountCents, userId }) {
    const key = config.stripeSecretKey;
    if (!key.startsWith('sk_test_')) throw badRequest('stripe-test provider requires a STRIPE_SECRET_KEY starting with sk_test_ (test mode only).');
    const body = new URLSearchParams({
      amount: String(amountCents), currency: 'usd', payment_method: 'pm_card_visa', confirm: 'true',
      'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
      'metadata[luckydraw_user]': String(userId), 'metadata[demo]': 'true',
    });
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const json = await res.json();
    if (!res.ok || json.status !== 'succeeded') throw badRequest(`Stripe test payment failed: ${json.error?.message || json.status}`);
    return { ok: true, provider: 'stripe-test', ref: json.id, amountCents };
  },
};

export const paymentsProvider = config.paymentsProvider === 'stripe-test' ? stripeTest : simulated;
