import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _reset, _storage, _setGates } from '../../__mocks__/@react-native-async-storage/async-storage.js';
import { readCheckoutRecovery, saveCheckoutRecovery, clearCheckoutRecovery, loadCheckoutRecovery, checkoutRecoveryScope } from '../checkoutRecovery.js';
import type { CheckoutRecovery } from '../checkoutRecovery.js';

beforeEach(() => _reset());
const fixture = (): CheckoutRecovery => ({
  accountId: 'owner-a', identity: { idempotencyKey: 'original', codReference: 'cod_original' },
  input: { idempotencyKey: 'original', fulfillment: 'collection', lineItems: [{ productId: 1, quantity: 2 }],
    shippingAddress: { firstName: 'Avery', lastName: 'Fixture', phone: '+254712345670',
      address1: 'Fixture contact address', city: '', country: 'KE' }, quotedTotal: 6998 },
  quote: { total: 6998, lines: [{ productId: 1, quantity: 2, name: 'Hydra Flux', subtotal: 6998 }] } as CheckoutRecovery['quote'],
  method: 'cod',
});

test('reload retains the original identity, frozen contact, quote and source quantities', async () => {
  const saved = fixture();
  await saveCheckoutRecovery(saved);
  assert.deepEqual(await readCheckoutRecovery('owner-a'), saved);
  assert.equal((await readCheckoutRecovery('owner-a'))!.identity.codReference, 'cod_original');
});

test('account switching cannot hydrate another account checkout; clearing is scoped', async () => {
  await saveCheckoutRecovery(fixture());
  assert.equal(await readCheckoutRecovery('owner-b'), null);
  await clearCheckoutRecovery('owner-b');
  assert.ok(await readCheckoutRecovery('owner-a'));
  await clearCheckoutRecovery('owner-a');
  assert.equal(await readCheckoutRecovery('owner-a'), null);
});

test('review receipt survives reload and cannot be replaced by a new checkout identity', async () => {
  await saveCheckoutRecovery({ ...fixture(), reviewOrderId: 73 });
  const saved = await readCheckoutRecovery('owner-a');
  assert.equal(saved!.reviewOrderId, 73);
  assert.equal(saved!.input.idempotencyKey, 'original');
});

test('corrupt, cross-account and unavailable storage fail closed', async () => {
  _storage.set('uc-checkout-recovery-v1:owner-a', '{');
  await assert.rejects(readCheckoutRecovery('owner-a'));
  _storage.set('uc-checkout-recovery-v1:owner-a', JSON.stringify({ ...fixture(), accountId: 'owner-b' }));
  await assert.rejects(readCheckoutRecovery('owner-a'), /safely/);
  _setGates({ set: () => Promise.reject(new Error('storage unavailable')) });
  await assert.rejects(saveCheckoutRecovery(fixture()), /storage unavailable/);
});

test('saved reconciliation envelopes reach the visible consumer without a fabricated transport error', () => {
  const api = readFileSync(new URL('../useApi.ts', import.meta.url), 'utf8');
  const create = api.slice(api.indexOf('    createOrder:'), api.indexOf('    /** Validates a checkout code'));
  assert.doesNotMatch(create, /throw new ApiError|\.then\(/);
  const checkout = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
  const branch = checkout.slice(checkout.indexOf('if (order.reconciliationRequired)'), checkout.indexOf("if (method === 'paystack'"));
  assert.match(branch, /setReviewOrderId\(order.id\)/);
  assert.match(branch, /setCheckoutFeedback/);
  assert.match(branch, /return false/);
  assert.doesNotMatch(branch, /clearCart|router\.replace/);
  assert.ok(checkout.indexOf('await saveCheckoutRecovery(recovery)') < checkout.indexOf("await createOrder('cod', 'COD')"));
  assert.match(checkout, /disabled=\{[^}\n]*!checkoutRecoveryReady \|\| reviewOrderId !== null/);
  assert.match(checkout, /View saved order/);
  const confirmed = checkout.slice(checkout.indexOf('recoveryRef.current = null;', checkout.indexOf('async function createOrder')), checkout.indexOf('clearCart();', checkout.indexOf('async function createOrder')));
  assert.match(confirmed, /paymentInputRef.current = null/);
  assert.match(confirmed, /orderIdentityRef.current = null/);
  assert.match(confirmed, /setPaymentFrozen\(false\)/);
  assert.match(confirmed, /setQuoteLoading\(false\)/);
});

test('account change clears private payment drafts and cancels old quote responses', () => {
  const checkout = readFileSync(new URL('../../app/checkout.tsx', import.meta.url), 'utf8');
  const reset = checkout.slice(checkout.indexOf('setCheckoutRecoveryReady(false)'), checkout.indexOf('loadCheckoutRecovery(user?.id)'));
  for (const setter of ["setMpesaPhone('')", "setPromoInput('')", 'setAppliedQuote(null)', 'setFulfillment(null)', 'setBaseQuote(null)']) {
    assert.ok(reset.includes(setter), setter);
  }
  assert.match(checkout, /\[user\?\.id, basketKey, fulfillment/);
  assert.match(checkout, /checkoutAccountRef\.current = undefined/);
  for (const action of ['applyPromoCode', 'applyReferralDiscount']) {
    const branch = checkout.slice(checkout.indexOf(`async function ${action}`), checkout.indexOf('\n  }', checkout.indexOf(`async function ${action}`)));
    assert.match(branch, /checkoutAccountRef\.current !== quotingAccountId/);
    assert.match(branch, /checkoutAccountRef\.current === quotingAccountId/);
  }
});

test('guest checkout becomes ready and retains one anonymous attempt across reload, separate from signed-in accounts', async () => {
  const loaded = await loadCheckoutRecovery();
  assert.equal(loaded.ready, true);
  assert.equal(loaded.saved, null);
  const guest = { ...fixture(), accountId: loaded.scope };
  await saveCheckoutRecovery(guest);
  const restored = await loadCheckoutRecovery();
  assert.equal(restored.ready, true);
  assert.equal(restored.saved!.identity.idempotencyKey, guest.identity.idempotencyKey);
  assert.equal((await loadCheckoutRecovery(23)).saved, null);
  await saveCheckoutRecovery({ ...fixture(), accountId: checkoutRecoveryScope(23) });
  await clearCheckoutRecovery(loaded.scope);
  assert.equal((await loadCheckoutRecovery()).saved, null);
  assert.ok((await loadCheckoutRecovery(23)).saved);
});