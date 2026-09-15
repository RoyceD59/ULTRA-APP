import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateColdStart } from '../coldStartNotification';

describe('Cold Start Notification State Machine', () => {
  test('returns CLEAR for empty or non-object data', () => {
    assert.deepEqual(evaluateColdStart(undefined, false), { type: 'CLEAR' });
    assert.deepEqual(evaluateColdStart(undefined, true), { type: 'CLEAR' });
  });

  test('order-detail: returns PENDING if logged out', () => {
    assert.deepEqual(
      evaluateColdStart({ screen: 'order-detail', orderId: '123' }, false),
      { type: 'PENDING' }
    );
  });

  test('order-detail: returns ROUTE_AND_CLEAR if logged in', () => {
    assert.deepEqual(
      evaluateColdStart({ screen: 'order-detail', orderId: '123' }, true),
      { type: 'ROUTE_AND_CLEAR', screen: 'order-detail', orderId: 123 }
    );
  });

  test('order-detail: returns CLEAR if orderId is malformed', () => {
    assert.deepEqual(
      evaluateColdStart({ screen: 'order-detail', orderId: 'abc' }, false),
      { type: 'CLEAR' }
    );
    assert.deepEqual(
      evaluateColdStart({ screen: 'order-detail', orderId: -5 }, true),
      { type: 'CLEAR' }
    );
  });

  test('public screens: returns ROUTE_AND_CLEAR regardless of auth', () => {
    assert.deepEqual(
      evaluateColdStart({ screen: 'products' }, false),
      { type: 'ROUTE_AND_CLEAR', screen: 'products' }
    );
    assert.deepEqual(
      evaluateColdStart({ screen: 'shop' }, true),
      { type: 'ROUTE_AND_CLEAR', screen: 'shop' }
    );
  });

  test('protected non-order screens: returns PENDING if logged out, ROUTE_AND_CLEAR if logged in', () => {
    assert.deepEqual(
      evaluateColdStart({ screen: 'orders' }, false),
      { type: 'PENDING' }
    );
    assert.deepEqual(
      evaluateColdStart({ screen: 'filterTracker' }, true),
      { type: 'ROUTE_AND_CLEAR', screen: 'filterTracker' }
    );
  });
});
