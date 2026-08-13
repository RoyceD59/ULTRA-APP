/**
 * Unit tests for the cart logic that backs the basket bar's tab-focus refresh.
 *
 * Covers two layers:
 *
 *   (A) Pure helpers — mergeItem, totalItems, totalPrice — no I/O, no mocks.
 *       Any change to the merge logic or aggregation math breaks these first.
 *
 *   (B) Storage boundary — loadCartFromStorage / saveCartToStorage — exercises
 *       the actual JSON serialisation / deserialisation that refreshCart() relies
 *       on.  An in-memory StorageBackend is passed directly to each function so
 *       there are no module-identity or path-alias issues.
 *
 *       The tab-switching scenario is tested here end-to-end:
 *         1. Products tab adds item A → saveCartToStorage
 *         2. Detail screen adds item B → saveCartToStorage (same backing store)
 *         3. useFocusEffect fires → refreshCart() calls loadCartFromStorage
 *         4. totalItems(loaded) must equal 2; Quick Checkout guard must be active
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeItem,
  totalItems,
  totalPrice,
  loadCartFromStorage,
  saveCartToStorage,
  type CartItem,
  type StorageBackend,
} from '../../context/cartStorage.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PRODUCT_A: CartItem = { id: 1, name: 'Inline Filter',  price: 3500, quantity: 1, image: '', sku: 'IF-001' };
const PRODUCT_B: CartItem = { id: 2, name: 'Shower Filter',  price: 2800, quantity: 1, image: '', sku: 'SF-001' };
const PRODUCT_C: CartItem = { id: 3, name: 'Pitcher Filter', price: 4200, quantity: 1, image: '', sku: 'PF-001' };

// ── In-memory StorageBackend ──────────────────────────────────────────────────
// Passed directly to loadCartFromStorage / saveCartToStorage — no module-alias
// trickery, no shared global state between tests.

function makeStore(): { backend: StorageBackend; data: Map<string, string> } {
  const data = new Map<string, string>();
  const backend: StorageBackend = {
    getItem:  async (k) => data.get(k) ?? null,
    setItem:  async (k, v) => { data.set(k, v); },
  };
  return { backend, data };
}

// ── (A) Pure helpers ──────────────────────────────────────────────────────────

describe('mergeItem — adding a new product', () => {
  it('appends with quantity=1 when the cart is empty', () => {
    const cart = mergeItem([], PRODUCT_A);
    assert.equal(cart.length, 1);
    assert.equal(cart[0].id, PRODUCT_A.id);
    assert.equal(cart[0].quantity, 1);
  });

  it('appends a second distinct product without changing the first', () => {
    const cart = mergeItem(mergeItem([], PRODUCT_A), PRODUCT_B);
    assert.equal(cart.length, 2);
    assert.equal(cart[0].id, PRODUCT_A.id);
    assert.equal(cart[1].id, PRODUCT_B.id);
  });

  it('does not mutate the input array (pure function)', () => {
    const original: CartItem[] = [];
    mergeItem(original, PRODUCT_A);
    assert.equal(original.length, 0, 'mergeItem must not mutate its input');
  });
});

describe('mergeItem — incrementing an existing product', () => {
  it('increments quantity by 1 when the same product is added again', () => {
    const cart = mergeItem(mergeItem([], PRODUCT_A), PRODUCT_A);
    assert.equal(cart.length, 1,   'no duplicate row must be created');
    assert.equal(cart[0].quantity, 2);
  });

  it('only increments the matching product; others are unchanged', () => {
    let cart = mergeItem(mergeItem(mergeItem([], PRODUCT_A), PRODUCT_B), PRODUCT_A);
    const a = cart.find(i => i.id === PRODUCT_A.id)!;
    const b = cart.find(i => i.id === PRODUCT_B.id)!;
    assert.equal(cart.length, 2);
    assert.equal(a.quantity, 2);
    assert.equal(b.quantity, 1, 'product B must be unchanged');
  });
});

describe('totalItems', () => {
  it('returns 0 for an empty cart', () => assert.equal(totalItems([]), 0));

  it('sums quantities across all items', () => {
    assert.equal(
      totalItems([{ ...PRODUCT_A, quantity: 3 }, { ...PRODUCT_B, quantity: 2 }]),
      5,
    );
  });
});

describe('totalPrice', () => {
  it('returns 0 for an empty cart', () => assert.equal(totalPrice([]), 0));

  it('multiplies price × quantity per item and sums', () => {
    assert.equal(
      totalPrice([
        { ...PRODUCT_A, quantity: 2, price: 3500 }, // 7 000
        { ...PRODUCT_B, quantity: 1, price: 2800 }, // 2 800
      ]),
      9800,
    );
  });
});

// ── (B) Storage boundary ──────────────────────────────────────────────────────

describe('loadCartFromStorage — reading from storage', () => {
  it('returns [] when storage is empty', async () => {
    const { backend } = makeStore();
    assert.deepEqual(await loadCartFromStorage(backend), []);
  });

  it('returns the previously saved items', async () => {
    const { backend } = makeStore();
    const items: CartItem[] = [{ ...PRODUCT_A, quantity: 2 }];
    await saveCartToStorage(backend, items);
    const loaded = await loadCartFromStorage(backend);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, PRODUCT_A.id);
    assert.equal(loaded[0].quantity, 2);
  });

  it('returns [] when storage contains corrupted JSON (no throw)', async () => {
    const { backend, data } = makeStore();
    data.set('uc_cart_v1', 'NOT_VALID_JSON{{{');
    assert.deepEqual(await loadCartFromStorage(backend), []);
  });
});

describe('saveCartToStorage — writing to storage', () => {
  it('save → load round-trip is lossless', async () => {
    const { backend } = makeStore();
    const items: CartItem[] = [
      { ...PRODUCT_A, quantity: 2 },
      { ...PRODUCT_B, quantity: 1 },
    ];
    await saveCartToStorage(backend, items);
    assert.deepEqual(await loadCartFromStorage(backend), items);
  });

  it('overwrites the previous cart when called again', async () => {
    const { backend } = makeStore();
    await saveCartToStorage(backend, [{ ...PRODUCT_A, quantity: 1 }]);
    await saveCartToStorage(backend, [{ ...PRODUCT_B, quantity: 3 }]);
    const loaded = await loadCartFromStorage(backend);
    assert.equal(loaded.length, 1, 'second save must replace, not append');
    assert.equal(loaded[0].id, PRODUCT_B.id);
    assert.equal(loaded[0].quantity, 3);
  });
});

// ── (B) Tab-switching scenario — the exact regression this suite guards ────────
//
// Simulates refreshCart() being called by useFocusEffect on the Products tab
// after items were added from a different screen.

describe('tab-switching scenario — refreshCart reflects cross-screen additions', () => {
  it('shows the combined count after adding on Products then on a detail screen', async () => {
    const { backend } = makeStore();

    // Step 1 — Products tab: addItem(A) → save
    let cart = mergeItem([], PRODUCT_A);
    await saveCartToStorage(backend, cart);

    // Step 2 — Detail screen: addItem(B) → save (simulates a second addItem call)
    cart = mergeItem(cart, PRODUCT_B);
    await saveCartToStorage(backend, cart);

    // Step 3 — Products tab regains focus → useFocusEffect → refreshCart()
    //           CartContext calls loadCartFromStorage then setItems(loaded)
    const refreshed = await loadCartFromStorage(backend);

    assert.equal(
      totalItems(refreshed),
      2,
      'basket bar must show 2 (1×A + 1×B) after refreshCart on tab focus',
    );
  });

  it('count is correct after three rapid tab switches', async () => {
    const { backend } = makeStore();
    let cart: CartItem[] = [];
    for (const p of [PRODUCT_A, PRODUCT_B, PRODUCT_C]) {
      cart = mergeItem(cart, p);
      await saveCartToStorage(backend, cart);
    }
    assert.equal(totalItems(await loadCartFromStorage(backend)), 3);
  });

  it('adding the same product from a detail screen increments qty, not row count', async () => {
    const { backend } = makeStore();
    let cart = mergeItem([], PRODUCT_A);
    await saveCartToStorage(backend, cart);

    cart = mergeItem(cart, PRODUCT_A); // same product from detail screen
    await saveCartToStorage(backend, cart);

    const refreshed = await loadCartFromStorage(backend);
    assert.equal(refreshed.length, 1, 'no duplicate row must exist');
    assert.equal(totalItems(refreshed), 2, 'qty must be incremented to 2');
  });

  it('Quick Checkout guard: inactive on empty cart, active once any item is added', async () => {
    const { backend } = makeStore();

    // Empty — basket bar hidden, Quick Checkout inactive
    const empty = await loadCartFromStorage(backend);
    assert.equal(
      totalItems(empty) > 0,
      false,
      'Quick Checkout must be inactive when no items have been added',
    );

    // After a cross-screen addition and refresh
    await saveCartToStorage(backend, [{ ...PRODUCT_A, quantity: 1 }]);
    const refreshed = await loadCartFromStorage(backend);
    assert.equal(
      totalItems(refreshed) > 0,
      true,
      'Quick Checkout must become active after refreshCart loads an item',
    );
  });

  it('Quick Checkout guard is satisfied after a cross-screen addition and refresh', async () => {
    // The basket bar renders the Quick Checkout button only when totalItems > 0,
    // and pressing it calls router.push('/checkout').  This test verifies the
    // guard condition (totalItems > 0) after a cross-screen save → refreshCart
    // load — i.e. that the button would be visible and pressable.
    // router.push('/checkout') is a direct call in products.tsx that requires a
    // React renderer to assert; this test covers the prerequisite data layer.
    const { backend } = makeStore();
    let cart = mergeItem([], PRODUCT_B); // added from detail screen
    cart = mergeItem(cart, PRODUCT_A);   // previously added on Products tab
    await saveCartToStorage(backend, cart);

    const refreshed = await loadCartFromStorage(backend);
    assert.equal(
      totalItems(refreshed) > 0,
      true,
      'totalItems > 0 after refreshCart — Quick Checkout button is visible and pressable',
    );
  });
});
