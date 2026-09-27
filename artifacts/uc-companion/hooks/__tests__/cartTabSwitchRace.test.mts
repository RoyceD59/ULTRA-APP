/**
 * Regression tests: a tab-switch refresh must never wipe quantity changes made
 * a split-second earlier (Task: refreshCart() racing rapid updateQty calls).
 *
 * The cart reloads from AsyncStorage on tab focus via refreshCart().  If the
 * user taps the quantity stepper and immediately switches tabs, the refresh
 * can read storage BEFORE the latest save settles and then overwrite newer
 * in-memory state with older persisted state.
 *
 * These tests render the REAL <CartProvider> via the minimal React stub
 * (__mocks__/react.ts, `__testRender`) and the shared in-memory AsyncStorage
 * stub.  They simulate: rapid updateQty calls → refreshCart() fired before /
 * while the saves settle → assert both the in-memory items and the persisted
 * AsyncStorage value reflect the latest stepper taps, not stale storage.
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

const PRODUCT_A: CartItem = { id: 1, name: 'Inline Filter', price: 3500, quantity: 1, image: '', sku: 'IF-001' };
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

// ── Tab-switch immediately after stepper taps ────────────────────────────────

describe('refreshCart racing rapid updateQty (tab switch right after stepper taps)', () => {
  it('refresh fired before the saves settle must not wipe the new quantities', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 1 },
      { ...PRODUCT_B, quantity: 1 },
    ]));
    const root = await mountCart();
    const { updateQty, refreshCart } = root.value;

    // Rapid stepper taps on A, then an IMMEDIATE tab switch: refreshCart()
    // starts while the taps' state updates + AsyncStorage saves are still
    // pending, so its read returns the OLD storage value (quantity 1).
    updateQty(PRODUCT_A.id, 2);
    updateQty(PRODUCT_A.id, 3);
    const refresh = refreshCart();   // reads stale storage before saves settle

    root.flush();
    await refresh;
    root.flush();
    await tick();                    // let AsyncStorage writes settle
    root.flush();

    const a = root.value.items.find(i => i.id === PRODUCT_A.id)!;
    const b = root.value.items.find(i => i.id === PRODUCT_B.id)!;
    assert.equal(root.value.items.length, 2, 'no item may be lost');
    assert.equal(a.quantity, 3, 'stale refresh must not overwrite the latest stepper tap');
    assert.equal(b.quantity, 1, 'untouched item must be unchanged');
    assert.deepEqual(storedItems(), root.value.items, 'AsyncStorage must match final state');
  });

  it('stepper tap landing WHILE a refresh is already in flight still wins', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();
    const { updateQty, refreshCart } = root.value;

    // Tab focus fires refreshCart first; user taps the stepper a split-second
    // later, while the refresh's storage read is still awaiting.
    const refresh = refreshCart();
    updateQty(PRODUCT_A.id, 4);

    root.flush();
    await refresh;
    root.flush();
    await tick();
    root.flush();

    assert.equal(root.value.items[0].quantity, 4, 'in-flight refresh must not clobber the newer tap');
    assert.deepEqual(storedItems(), root.value.items);
  });

  it('interleaved taps on two items survive a mid-burst refresh', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 1 },
      { ...PRODUCT_B, quantity: 1 },
    ]));
    const root = await mountCart();
    const { updateQty, refreshCart } = root.value;

    updateQty(PRODUCT_A.id, 2);
    const refresh = refreshCart();   // tab switch mid-burst
    updateQty(PRODUCT_B.id, 5);

    root.flush();
    await refresh;
    root.flush();
    await tick();
    root.flush();

    const a = root.value.items.find(i => i.id === PRODUCT_A.id)!;
    const b = root.value.items.find(i => i.id === PRODUCT_B.id)!;
    assert.equal(a.quantity, 2);
    assert.equal(b.quantity, 5);
    assert.equal(root.value.totalItems, 7);
    assert.deepEqual(storedItems(), root.value.items);
  });
});

// ── Refresh must still pick up genuinely newer storage when idle ─────────────

describe('refreshCart still applies fresh storage when no mutation is pending', () => {
  it('cross-screen change written to storage is loaded by a later refresh', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();

    // Another screen (same storage) updated the cart while this tab was blurred.
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 2 },
      { ...PRODUCT_B, quantity: 1 },
    ]));

    await root.value.refreshCart();
    root.flush();

    assert.equal(root.value.items.length, 2, 'idle refresh must still pull in newer storage');
    assert.equal(root.value.totalItems, 3);
  });

  it('refresh after taps have fully settled is a no-op, not a revert', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();

    root.value.updateQty(PRODUCT_A.id, 6);
    root.flush();
    await tick();                    // saves fully settled

    await root.value.refreshCart();
    root.flush();

    assert.equal(root.value.items[0].quantity, 6);
    assert.deepEqual(storedItems(), root.value.items);
  });
});

// ── Adversarial deferred storage: writes settle late / out of order ──────────

/** One-shot manual gate: I/O blocks until release() is called. */
function makeGate() {
  let release!: () => void;
  const opened = new Promise<void>(r => { release = r; });
  return { wait: () => opened, release };
}

describe('deferred AsyncStorage writes (adversarial completion order)', () => {
  it('refresh while writes are still blocked keeps the tapped quantities; only the newest snapshot commits', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();
    const { updateQty, refreshCart } = root.value;

    // From now on every setItem blocks until we release the gate — the taps'
    // saves stay pending long after the tab switch.
    const gate = makeGate();
    _setGates({ set: gate.wait });

    updateQty(PRODUCT_A.id, 2);
    updateQty(PRODUCT_A.id, 3);
    root.flush();                    // persistence queued, but writes blocked
    await tick();
    assert.deepEqual(storedItems(), [{ ...PRODUCT_A, quantity: 1 }],
      'precondition: storage must still hold the stale value');

    // Tab switch: refresh reads storage while it is provably stale.
    await refreshCart();
    root.flush();
    assert.equal(root.value.items[0].quantity, 3,
      'refresh reading pre-save storage must not revert the stepper taps');

    // Release the blocked writes and let the serialized chain drain.
    gate.release();
    await tick(); await tick();

    assert.deepEqual(storedItems(), [{ ...PRODUCT_A, quantity: 3 }],
      'only the newest snapshot may commit — a superseded write must never win');

    // A later refresh now agrees with storage and stays at 3.
    await refreshCart();
    root.flush();
    assert.equal(root.value.items[0].quantity, 3);
  });

  it('slow first write cannot settle after a fast second write (no out-of-order final value)', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();
    const { updateQty } = root.value;

    // First tap's write is held back; second tap's write is released first.
    const first = makeGate();
    let call = 0;
    _setGates({ set: () => (++call === 1 ? first.wait() : Promise.resolve()) });

    updateQty(PRODUCT_A.id, 2);      // slow write
    root.flush();
    await tick();                    // write of qty=2 is now blocked in flight
    updateQty(PRODUCT_A.id, 3);      // fast write, queued behind it
    root.flush();
    await tick();

    first.release();                 // stale write finally settles
    await tick(); await tick();

    assert.deepEqual(storedItems(), [{ ...PRODUCT_A, quantity: 3 }],
      'the older write must not become the final persisted cart');
    assert.equal(root.value.items[0].quantity, 3);
  });

  it('a FAILED save must not permanently disable refresh: later refresh still applies newer storage', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();
    const { updateQty, refreshCart } = root.value;

    // Every setItem rejects: the tap's save (and its retry) fail outright.
    _setGates({ set: () => Promise.reject(new Error('disk full')) });

    updateQty(PRODUCT_A.id, 2);
    root.flush();
    await tick(); await tick();      // let the failed save + retry settle
    assert.deepEqual(JSON.parse(_storage.get(CART_STORAGE_KEY)!), [{ ...PRODUCT_A, quantity: 1 }],
      'precondition: the save must actually have failed');

    // Storage recovers, and another screen writes genuinely newer data.
    _setGates({});
    _storage.set(CART_STORAGE_KEY, JSON.stringify([
      { ...PRODUCT_A, quantity: 7 },
      { ...PRODUCT_B, quantity: 1 },
    ]));

    await refreshCart();
    root.flush();

    assert.equal(root.value.items.length, 2,
      'refresh after a failed save must still apply newer storage');
    const a = root.value.items.find(i => i.id === PRODUCT_A.id)!;
    assert.equal(a.quantity, 7, 'genuinely newer storage data must win once the failed save has settled');
  });

  it('a save that fails once but succeeds on retry still persists the snapshot', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();
    const { updateQty, refreshCart } = root.value;

    let call = 0;
    _setGates({ set: () => (++call === 1 ? Promise.reject(new Error('transient')) : Promise.resolve()) });

    updateQty(PRODUCT_A.id, 4);
    root.flush();
    await tick(); await tick();

    assert.deepEqual(storedItems(), [{ ...PRODUCT_A, quantity: 4 }],
      'retry must persist the snapshot after a transient failure');

    await refreshCart();
    root.flush();
    assert.equal(root.value.items[0].quantity, 4);
  });

  it('slow refresh read that completes after new taps must not clobber them', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify([{ ...PRODUCT_A, quantity: 1 }]));
    const root = await mountCart();
    const { updateQty, refreshCart } = root.value;

    // Refresh's storage read hangs; meanwhile the user keeps tapping.
    const read = makeGate();
    _setGates({ get: read.wait });
    const refresh = refreshCart();

    updateQty(PRODUCT_A.id, 5);
    root.flush();
    await tick();

    read.release();                  // stale read finally resolves
    await refresh;
    root.flush();
    await tick();
    root.flush();

    assert.equal(root.value.items[0].quantity, 5,
      'a slow refresh must not apply data read before the taps');
    assert.deepEqual(storedItems(), root.value.items);
  });
});
