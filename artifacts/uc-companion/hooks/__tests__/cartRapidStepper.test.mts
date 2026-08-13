/**
 * Regression tests: cart items must not be lost when the quantity stepper is
 * tapped rapidly (Task: rapid consecutive updateQty / removeItem calls before
 * any re-render).
 *
 * These tests render the REAL <CartProvider> from context/CartContext.tsx via
 * a minimal React stub (__mocks__/react.ts) whose useState implements React's
 * batching semantics: setState calls between renders are queued and applied in
 * order at the next render, with functional updaters receiving the latest
 * pending value.
 *
 * That makes a stale-closure regression observable: if CartContext ever goes
 * back to computing next state from the render-time `items` variable instead
 * of `setItems(prev => ...)`, updates issued between renders overwrite each
 * other and these tests fail.
 *
 * AsyncStorage is the shared in-memory stub from __mocks__; each test asserts
 * both the final items array AND the persisted AsyncStorage value.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { __testRender } from 'react';
import { CartProvider, type CartItem } from '../../context/CartContext.js';
import { CART_STORAGE_KEY } from '../../context/cartStorage.js';
import { _storage, _reset } from '@react-native-async-storage/async-storage';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PRODUCT_A: CartItem = { id: 1, name: 'Inline Filter', price: 3500, quantity: 1, image: '', sku: 'IF-001' };
const PRODUCT_B: CartItem = { id: 2, name: 'Shower Filter', price: 2800, quantity: 1, image: '', sku: 'SF-001' };
const PRODUCT_C: CartItem = { id: 3, name: 'Pitcher Filter', price: 4200, quantity: 1, image: '', sku: 'PF-001' };

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

/** Render CartProvider and wait for the AsyncStorage hydration effect. */
async function mountCart() {
  const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
  await tick();      // let loadCartFromStorage resolve
  root.flush();      // apply setItems / setCartHydrated from hydration
  assert.equal(root.value.cartHydrated, true, 'cart must hydrate before the test proceeds');
  return root;
}

function storedItems(): CartItem[] {
  const raw = _storage.get(CART_STORAGE_KEY);
  assert.ok(raw !== undefined, 'cart must have been persisted to AsyncStorage');
  return JSON.parse(raw!) as CartItem[];
}

beforeEach(() => _reset());

// ── Rapid stepper taps ────────────────────────────────────────────────────────

describe('rapid updateQty calls before any re-render', () => {
  it('last quantity wins and no item is lost after a burst of stepper taps', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 1 },
      { ...PRODUCT_B, quantity: 1 },
    ]));
    const root = await mountCart();
    const { updateQty } = root.value; // captured from ONE render — closures stay stale

    // Rapid stepper taps on A: 2 → 3 → 4 → 5, all before any re-render
    updateQty(PRODUCT_A.id, 2);
    updateQty(PRODUCT_A.id, 3);
    updateQty(PRODUCT_A.id, 4);
    updateQty(PRODUCT_A.id, 5);
    root.flush();
    await tick(); // let the async saveCartToStorage writes settle

    const a = root.value.items.find(i => i.id === PRODUCT_A.id)!;
    const b = root.value.items.find(i => i.id === PRODUCT_B.id)!;
    assert.equal(root.value.items.length, 2, 'no item may be lost');
    assert.equal(a.quantity, 5, 'final tap must win');
    assert.equal(b.quantity, 1, 'untouched item must be unchanged');
    assert.deepEqual(storedItems(), root.value.items, 'AsyncStorage must match final state');
  });

  it('interleaved rapid updates to two different items are both applied', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 1 },
      { ...PRODUCT_B, quantity: 1 },
    ]));
    const root = await mountCart();
    const { updateQty } = root.value;

    // Alternate steppers on A and B without a re-render in between. With a
    // stale closure, the B update would clobber the A update (or vice versa).
    updateQty(PRODUCT_A.id, 2);
    updateQty(PRODUCT_B.id, 4);
    updateQty(PRODUCT_A.id, 3);
    root.flush();
    await tick();

    const a = root.value.items.find(i => i.id === PRODUCT_A.id)!;
    const b = root.value.items.find(i => i.id === PRODUCT_B.id)!;
    assert.equal(a.quantity, 3);
    assert.equal(b.quantity, 4);
    assert.equal(root.value.totalItems, 7);
    assert.deepEqual(storedItems(), root.value.items);
  });
});

describe('rapid updateQty + removeItem before any re-render', () => {
  it('removing one item while stepping another loses neither update', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 1 },
      { ...PRODUCT_B, quantity: 1 },
      { ...PRODUCT_C, quantity: 1 },
    ]));
    const root = await mountCart();
    const { updateQty, removeItem } = root.value;

    updateQty(PRODUCT_A.id, 3);   // step A up
    removeItem(PRODUCT_B.id);     // remove B
    updateQty(PRODUCT_C.id, 2);   // step C up — all before re-render
    root.flush();
    await tick();

    assert.deepEqual(
      root.value.items.map(i => ({ id: i.id, quantity: i.quantity })),
      [{ id: 1, quantity: 3 }, { id: 3, quantity: 2 }],
      'A stepped to 3, B removed, C stepped to 2',
    );
    assert.deepEqual(storedItems(), root.value.items, 'AsyncStorage must match final state');
  });

  it('updateQty(id, 0) in a rapid burst removes the item without touching others', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 2 },
      { ...PRODUCT_B, quantity: 2 },
    ]));
    const root = await mountCart();
    const { updateQty } = root.value;

    // Stepper tapped down rapidly: 1 then 0 (0 ⇒ remove), while B steps up.
    updateQty(PRODUCT_A.id, 1);
    updateQty(PRODUCT_B.id, 3);
    updateQty(PRODUCT_A.id, 0);
    root.flush();
    await tick();

    assert.deepEqual(
      root.value.items.map(i => ({ id: i.id, quantity: i.quantity })),
      [{ id: 2, quantity: 3 }],
      'A removed via qty 0; B kept its stepped-up quantity',
    );
    assert.deepEqual(storedItems(), root.value.items);
  });
});

describe('rapid addItem calls before any re-render (regression canary)', () => {
  it('adding the same product 5 times in a burst yields quantity 5, not 1', async () => {
    const root = await mountCart();
    const { addItem } = root.value;

    for (let i = 0; i < 5; i++) addItem(PRODUCT_A);
    root.flush();
    await tick();

    assert.equal(root.value.items.length, 1);
    assert.equal(root.value.items[0].quantity, 5, 'a stale closure would leave quantity at 1');
    assert.deepEqual(storedItems(), root.value.items);
  });

  it('adding two different products in a burst keeps both', async () => {
    const root = await mountCart();
    const { addItem } = root.value;

    addItem(PRODUCT_A);
    addItem(PRODUCT_B);
    root.flush();
    await tick();

    assert.equal(root.value.items.length, 2, 'a stale closure would drop the first product');
    assert.equal(root.value.totalItems, 2);
    assert.deepEqual(storedItems(), root.value.items);
  });
});
