/**
 * Regression tests for the checkout empty-cart flash (hydration guard).
 *
 * On a slow device, CartContext's AsyncStorage read can still be in flight
 * when the checkout screen mounts (direct deep-link, or a fast swipe from the
 * products tab).  Before the guard existed, checkout rendered its normal UI
 * against the not-yet-hydrated `items: []`, flashing "$0.00" / empty line
 * items for a frame or two.  The fix has two halves, each covered here:
 *
 *   (1) CartContext must report `cartHydrated: false` for the entire window
 *       in which `items` may still be the empty pre-hydration default —
 *       including when the AsyncStorage read is slow or fails outright.
 *       (Tests A/B/C below, exercised with a gated AsyncStorage stub that
 *       simulates a slow device.)
 *
 *   (2) checkout.tsx must early-return a spinner while `cartHydrated` is
 *       false, BEFORE any JSX that renders items or totals.  The screen pulls
 *       in too many Expo native modules to render under the Node test runner,
 *       so this half is a source-level tripwire (Test D) plus the on-device
 *       manual plan in docs/checkout-hydration-test-plan.md, which covers the
 *       deep-link and fast-swipe navigation paths end to end.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { __testRender } from 'react';
import { _storage, _reset, _setGates } from '@react-native-async-storage/async-storage';
import { CartProvider, type CartItem } from '../../context/CartContext.js';
import { CART_STORAGE_KEY } from '../../context/cartStorage.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

interface CartValue {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  cartHydrated: boolean;
  refreshCart: () => Promise<void>;
}

const STORED: CartItem[] = [
  { id: 1, name: 'Inline Filter', price: 3500, quantity: 2, image: '', sku: 'IF-001' },
];

beforeEach(() => _reset());

describe('CartContext hydration flag (slow-device simulation)', () => {
  it('A: cartHydrated stays false while the AsyncStorage read is in flight', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify(STORED));

    // Gate the read open-endedly: this is the slow device.  The checkout
    // screen can mount (deep link or fast swipe) at any point in this window.
    let releaseRead!: () => void;
    _setGates({ get: () => new Promise<void>(r => { releaseRead = r; }) });

    const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
    await tick();
    root.flush();

    // The flash pre-condition: items is the empty default and totals are 0.
    // The ONLY thing standing between the user and a "$0.00" flash is the
    // cartHydrated flag — it must be false for this entire window.
    assert.equal(root.value.cartHydrated, false,
      'cartHydrated must be false while the storage read is pending');
    assert.deepEqual(root.value.items, []);
    assert.equal(root.value.totalPrice, 0);

    // Slow read finally completes → hydrated with the real cart.
    releaseRead();
    await tick(); await tick();
    root.flush();
    assert.equal(root.value.cartHydrated, true);
    assert.equal(root.value.totalItems, 2);
    assert.equal(root.value.totalPrice, 7000);
  });

  it('B: a failed storage read still sets cartHydrated (spinner cannot hang forever)', async () => {
    _setGates({ get: () => Promise.reject(new Error('disk I/O error')) });

    const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
    await tick(); await tick();
    root.flush();

    // finally{} semantics: even when the read blows up, hydration completes so
    // the checkout guard releases and the user sees the (genuinely) empty cart
    // rather than an eternal spinner.
    assert.equal(root.value.cartHydrated, true,
      'cartHydrated must be set even when the storage read fails');
    assert.deepEqual(root.value.items, []);
  });

  it('C: refreshCart (tab-focus re-read) never flips cartHydrated back to false', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify(STORED));
    const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
    await tick();
    root.flush();
    assert.equal(root.value.cartHydrated, true);

    // Fast-swipe path: products tab triggers refreshCart on focus just before
    // checkout mounts.  A slow re-read must NOT resurrect the spinner state.
    let releaseRead!: () => void;
    _setGates({ get: () => new Promise<void>(r => { releaseRead = r; }) });
    const refresh = root.value.refreshCart();
    root.flush();
    assert.equal(root.value.cartHydrated, true,
      'an in-flight refresh must not un-hydrate the cart');
    releaseRead();
    await refresh;
    root.flush();
    assert.equal(root.value.cartHydrated, true);
    assert.equal(root.value.totalItems, 2);
  });
});

describe('checkout.tsx hydration guard (source-level tripwire)', () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/checkout.tsx'),
    'utf8',
  );

  it('D: early-returns a spinner on !cartHydrated before any cart UI renders', () => {
    // The guard block must exist…
    const guardMatch = src.match(/if\s*\(\s*!cartHydrated\s*\)\s*\{/);
    assert.ok(guardMatch, 'checkout.tsx must early-return when cartHydrated is false');
    const guardIdx = guardMatch.index!;

    // …must render an ActivityIndicator (spinner), not cart UI…
    const guardBlock = src.slice(guardIdx, guardIdx + 600);
    assert.match(guardBlock, /ActivityIndicator/,
      'the !cartHydrated branch must show a spinner');
    assert.doesNotMatch(guardBlock, /totalPrice|items\.map|Order Summary/,
      'the !cartHydrated branch must not render totals or line items');

    // …and must sit BEFORE the main return that renders address/payment/totals,
    // so no frame can paint $0.00 or empty line items pre-hydration.
    const mainReturnIdx = src.indexOf('Delivery Address');
    assert.ok(mainReturnIdx > -1, 'expected the main checkout JSX to exist');
    assert.ok(guardIdx < mainReturnIdx,
      'the hydration guard must come before the main checkout JSX');
  });
});
