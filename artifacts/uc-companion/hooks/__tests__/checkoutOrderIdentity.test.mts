import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { retainCheckoutOrderIdentity } from '../checkoutOrderIdentity.js';

describe('checkout order identity', () => {
  it('retains one stable unique identity for retries while separate checkouts do not collide', () => {
    const firstAttempt = retainCheckoutOrderIdentity(null, 'cart-attempt-a');
    const firstRetry = retainCheckoutOrderIdentity(firstAttempt, 'must-not-replace');
    const secondCheckout = retainCheckoutOrderIdentity(null, 'cart-attempt-b');

    assert.strictEqual(firstRetry, firstAttempt);
    assert.equal(firstRetry.idempotencyKey, 'cart-attempt-a');
    assert.equal(firstRetry.codReference, 'cod_cart-attempt-a');
    assert.notEqual(secondCheckout.idempotencyKey, firstAttempt.idempotencyKey);
    assert.notEqual(secondCheckout.codReference, firstAttempt.codReference);
  });
});