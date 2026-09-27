/**
 * Regression tests: clearing the cart mid-session (from checkout, or when an
 * order completes) must leave the cart empty from every observer's point of
 * view — in-memory items, persisted AsyncStorage, and any refreshCart() fired
 * by the products tab regaining focus while the clear's write is still
 * settling.  The products-tab basket bar is driven purely by
 * `items.length > 0`, so "items stays empty" is exactly "the basket bar hides
 * and stays hidden" (no resurrection flash / double-render).
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { __testRender } from 'react';
import { CartProvider, type CartItem } from '../../context/CartContext.js';
import { CART_STORAGE_KEY } from '../../context/cartStorage.js';
import { _storage, _reset, _setGates } from '@react-native-async-storage/async-storage';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PRODUCT_A: CartItem = { id: 1, name: 'Inline Filter', price: 3500, quantity: 2, image: '', sku: 'IF-001' };
const PRODUCT_B: CartItem = { id: 2, name: 'Shower Filter', price: 2800, quantity: 1, image: '', sku: 'SF-001' };

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

interface CartValue {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  cartHydrated: boolean;
  addItem: (p: CartItem) => void;
  removeItem: (id: number) => void;
  updateQty: (id: number, qty: number) => void;
  clearCart: () => void;
  refreshCart: () => Promise<void>;
}

async function mountCart() {
  const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
  await tick();
  root.flush();
  assert.equal(root.value.cartHydrated, true, 'cart must hydrate before the test proceeds');
  return root;
}

function makeGate() {
  let release!: () => void;
  const promise = new Promise<void>(r => { release = r; });
  return { wait: () => promise, release };
}

describe('clearCart mid-session (basket bar hide path)', () => {
  beforeEach(() => { _reset(); });

  it('clears in-memory items and persists [] so the basket bar hides', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_A, PRODUCT_B]));
    const root = await mountCart();
    assert.equal(root.value.items.length, 2);

    root.value.clearCart();
    root.flush();

    // Basket-bar driver: items must be empty immediately (synchronously).
    assert.equal(root.value.items.length, 0);
    assert.equal(root.value.totalItems, 0);
    assert.equal(root.value.totalPrice, 0);

    await tick(); // let the persist chain settle
    assert.equal(_storage.get(CART_STORAGE_KEY), '[]', 'empty cart must be persisted');
  });

  it('a tab-focus refreshCart() racing the clear cannot resurrect the cart', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_A]));
    const root = await mountCart();
    assert.equal(root.value.items.length, 1);

    // Block the [] write so storage still holds the OLD (non-empty) cart
    // while the products tab regains focus and fires refreshCart().
    const gate = makeGate();
    _setGates({ set: gate.wait });

    root.value.clearCart();
    root.flush();
    assert.equal(root.value.items.length, 0, 'clear applies to memory immediately');

    // Tab focus → refreshCart() reads storage that STILL contains PRODUCT_A.
    const refresh = root.value.refreshCart();
    await tick();
    root.flush();

    assert.equal(root.value.items.length, 0,
      'stale storage read during an unsettled clear must not bring items back');

    // Let the clear's write settle, finish the refresh: still empty everywhere.
    gate.release();
    _setGates({});
    await refresh;
    await tick();
    root.flush();

    assert.equal(root.value.items.length, 0);
    assert.equal(_storage.get(CART_STORAGE_KEY), '[]');
  });

  it('a refreshCart() after the clear settles keeps the cart empty', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([PRODUCT_A, PRODUCT_B]));
    const root = await mountCart();

    root.value.clearCart();
    root.flush();
    await tick(); // clear write settles

    await root.value.refreshCart();
    root.flush();

    assert.equal(root.value.items.length, 0);
    assert.equal(root.value.cartHydrated, true);
    assert.equal(_storage.get(CART_STORAGE_KEY), '[]');
  });
});
