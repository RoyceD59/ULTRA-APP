/**
 * Regression tests: resuming from background must rehydrate the cart from
 * AsyncStorage so a purged-and-restarted JS context (low-memory Android)
 * never shows a stale empty state.
 *
 * CartContext subscribes to AppState changes and calls loadFromStorage()
 * on every background/inactive → active transition.  These tests render the
 * REAL <CartProvider> via the minimal React stub (__mocks__/react.ts) and
 * drive foreground/background transitions through the controllable AppState
 * mock (__mocks__/react-native.ts, __setAppState).
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { __testRender } from 'react';
import { __setAppState, __resetAppState, __appStateListenerCount } from 'react-native';
import { CartProvider, type CartItem } from '../../context/CartContext.js';
import { CART_STORAGE_KEY } from '../../context/cartStorage.js';
import { _storage, _reset } from '@react-native-async-storage/async-storage';

const PRODUCT_A: CartItem = { id: 1, name: 'Inline Filter', price: 3500, quantity: 2, image: '', sku: 'IF-001' };
const PRODUCT_B: CartItem = { id: 2, name: 'Shower Filter', price: 2800, quantity: 1, image: '', sku: 'SF-001' };

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

interface CartValue {
  items: CartItem[];
  totalItems: number;
  cartHydrated: boolean;
  refreshCart: () => Promise<void>;
}

async function mountCart() {
  const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
  await tick();
  root.flush();
  assert.equal(root.value.cartHydrated, true, 'cart must hydrate after mount');
  return root;
}

beforeEach(() => {
  _reset();
  __resetAppState();
});

describe('background → active resume rehydrates the cart', () => {
  it('reloads items written to storage while the app was backgrounded', async () => {
    const root = await mountCart();
    assert.equal(root.value.totalItems, 0, 'starts empty');

    // App goes to background; another context (or the pre-kill session)
    // persisted a cart to storage.
    __setAppState('background');
    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_A, PRODUCT_B]));

    // Resume: listener must fire loadFromStorage and repopulate the cart.
    __setAppState('active');
    await tick();
    root.flush();

    assert.equal(root.value.totalItems, 3, 'cart must reflect storage after resume (2×A + 1×B)');
    assert.equal(root.value.items.length, 2);
  });

  it('rehydrates on inactive → active (iOS interruption path)', async () => {
    const root = await mountCart();

    __setAppState('inactive');
    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_B]));

    __setAppState('active');
    await tick();
    root.flush();

    assert.equal(root.value.totalItems, 1);
  });

  it('does not reload on active → background (only foreground transitions refresh)', async () => {
    const root = await mountCart();

    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_A]));
    __setAppState('background');
    await tick();
    root.flush();

    assert.equal(root.value.totalItems, 0, 'backgrounding must not trigger a reload');
  });

  it('repeated active events without leaving foreground do not duplicate listeners', async () => {
    const root = await mountCart();
    assert.equal(__appStateListenerCount(), 1, 'exactly one AppState listener must be subscribed');

    // Extra renders (state churn) must not stack additional subscriptions.
    __setAppState('background');
    __setAppState('active');
    await tick();
    root.flush();
    assert.equal(__appStateListenerCount(), 1, 'listener count must stay 1 after resume cycles');
  });

  it('cold-restart simulation: a fresh provider over existing storage hydrates then stays fresh on resume', async () => {
    // Simulates the OS killing the JS context: storage survives, provider remounts.
    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_A]));
    const root = await mountCart();
    assert.equal(root.value.totalItems, 2, 'remounted provider hydrates from surviving storage');

    // Cart changes externally while backgrounded, then resume.
    __setAppState('background');
    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_A, PRODUCT_B]));
    __setAppState('active');
    await tick();
    root.flush();

    assert.equal(root.value.totalItems, 3, 'resume picks up the newer stored cart');
  });
});
