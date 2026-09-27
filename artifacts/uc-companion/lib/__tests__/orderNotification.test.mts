import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOrderNotificationId } from '../orderNotification.ts';

describe('order notification routing', () => {
  it('accepts valid cold-start order payloads', () => {
    assert.equal(parseOrderNotificationId({ screen: 'order-detail', orderId: '123' }), 123);
    assert.equal(parseOrderNotificationId({ screen: 'order-detail', orderId: 456 }), 456);
  });

  it('rejects malformed or unrelated payloads', () => {
    for (const orderId of ['abc', -10, '0', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(parseOrderNotificationId({ screen: 'order-detail', orderId }), null);
    }
    assert.equal(parseOrderNotificationId({ screen: 'products', orderId: 123 }), null);
    assert.equal(parseOrderNotificationId(undefined), null);
  });
});