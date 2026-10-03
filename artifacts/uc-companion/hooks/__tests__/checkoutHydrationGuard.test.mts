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

  it('B1: a transient read failure is retried once and hydrates with the saved cart', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify(STORED));

    // First read throws, retry succeeds — mirrors the write path's retry.
    let calls = 0;
    _setGates({
      get: () => (++calls === 1
        ? Promise.reject(new Error('disk I/O error'))
        : Promise.resolve()),
    });

    const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
    await tick(); await tick(); await tick();
    root.flush();

    assert.equal(calls >= 2, true, 'the failed read must be retried once');
    assert.equal(root.value.cartHydrated, true);
    assert.equal(root.value.totalItems, 2, 'the saved cart must survive a transient read error');
  });

  it('B2: a read that fails twice must NOT hydrate (no confident "basket is empty" lie)', async () => {
    _storage.set(CART_STORAGE_KEY, JSON.stringify(STORED));
    _setGates({ get: () => Promise.reject(new Error('disk I/O error')) });

    const root = __testRender<{ children: null }, CartValue>(CartProvider as any, { children: null });
    await tick(); await tick(); await tick();
    root.flush();

    // We couldn't read storage, so we don't know the cart is empty — the UI
    // must stay in its neutral loading state rather than flash "basket empty"
    // against the pre-hydration default items: [].
    assert.equal(root.value.cartHydrated, false,
      'cartHydrated must stay false when the read fails twice');
    assert.deepEqual(root.value.items, []);

    // Storage recovers (e.g. a foreground refresh re-reads) → hydrates normally.
    _setGates({});
    await root.value.refreshCart();
    root.flush();
    assert.equal(root.value.cartHydrated, true);
    assert.equal(root.value.totalItems, 2);
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

const readAppSource = (rel: string) =>
  fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../', rel),
    'utf8',
  );

describe('checkout.tsx hydration guard (source-level tripwire)', () => {
  const src = readAppSource('app/checkout.tsx');

  it('D: early-returns a spinner on !cartHydrated before any cart UI renders', () => {
    // The guard block must exist…
    const guardMatch = src.match(/if\s*\(\s*!cartHydrated\s*\)\s*\{/);
    assert.ok(guardMatch, 'checkout.tsx must early-return when cartHydrated is false');
    const guardIdx = guardMatch.index!;

    // The load-error recovery UI lives in its own `if (cartLoadError)` guard
    // ABOVE this block, so the !cartHydrated block stays a pure spinner.
    const guardEnd = src.indexOf('\n  }', guardIdx);
    assert.ok(guardEnd > guardIdx, 'the !cartHydrated guard must be a closed block');
    const guardBlock = src.slice(guardIdx, guardEnd + 4);

    // Must contain a spinner for the normal loading case…
    assert.match(guardBlock, /ActivityIndicator/,
      'the !cartHydrated block must include an ActivityIndicator for the loading case');

    // …and the cartLoadError retry path must exist as its own guard before it…
    const errGuard = src.match(/if\s*\(\s*cartLoadError\s*\)\s*\{/);
    assert.ok(errGuard, 'checkout.tsx must render a recovery UI when cartLoadError is set');
    assert.ok(errGuard!.index! < guardIdx,
      'the cartLoadError guard must come before the !cartHydrated spinner guard');
    assert.match(src.slice(errGuard!.index!, errGuard!.index! + 1200), /refreshCart|Retry/,
      'the cartLoadError guard must offer a retry path');

    // …but must never render checkout-specific UI (totals, line items, address).
    assert.doesNotMatch(guardBlock, /totalPrice|items\.map|Order Summary|Delivery Address/,
      'the !cartHydrated block must not render cart totals or checkout form fields');

    // …and must sit BEFORE the main return that renders address/payment/totals,
    // so no frame can paint $0.00 or empty line items pre-hydration.
    const mainReturnIdx = src.indexOf('Delivery Address');
    assert.ok(mainReturnIdx > -1, 'expected the main checkout JSX to exist');
    assert.ok(guardIdx < mainReturnIdx,
      'the hydration guard must come before the main checkout JSX');
  });
});

describe('other cart surfaces respect cartHydrated (source-level tripwires)', () => {
  it('E: cart screen early-returns a page loader on !cartHydrated before the empty state', () => {
    const src = readAppSource('app/cart.tsx');
    assert.match(src, /cartHydrated/, 'cart.tsx must read cartHydrated from useCart()');

    const guardMatch = src.match(/if\s*\(\s*!cartHydrated\s*\)\s*\{/);
    assert.ok(guardMatch, 'cart.tsx must early-return when cartHydrated is false');
    const guardIdx = guardMatch.index!;

    // The guard block ends where the next statement (the empty-cart check)
    // begins — inspect only the guard's own return.
    const nextStmtIdx = src.indexOf('if (items.length === 0)', guardIdx);
    assert.ok(nextStmtIdx > guardIdx, 'expected the empty-cart check after the guard');
    const guardBlock = src.slice(guardIdx, nextStmtIdx);
    assert.match(guardBlock, /PageDataLoader/,
      'the !cartHydrated branch must show the accessible page-data loader');
    assert.doesNotMatch(guardBlock, /Your cart is empty|items\.map|totalPrice/,
      'the !cartHydrated branch must not render the empty state or totals');

    // Guard must sit BEFORE the empty-cart return so no frame can flash the
    // empty state against the pre-hydration default items: [].  The empty-cart
    // JSX (>emptyTitle text) must only exist after the guard.
    const emptyJsxIdx = src.indexOf('styles.emptyTitle');
    assert.ok(emptyJsxIdx > -1, 'expected the empty-cart JSX to exist');
    assert.ok(guardIdx < emptyJsxIdx,
      'the hydration guard must come before the empty-cart JSX');
  });

  it('F: GlobalCartBar and tab badge gate visibility on cartHydrated', () => {
    const src = readAppSource('app/(tabs)/_layout.tsx');

    // The basket bar's visibility flag must AND cartHydrated with the count so
    // a JS-context restart cannot animate the bar out against a stale zero.
    assert.match(src, /hasItems\s*=\s*cartHydrated\s*&&\s*totalItems\s*>\s*0/,
      'GlobalCartBar must gate hasItems on cartHydrated');

    // The Products tab badge must not derive from the pre-hydration default.
    assert.match(readAppSource('components/CompanionNavigation.tsx'), /cartHydrated\s*&&\s*totalItems\s*>\s*0/,
      'the tab badge must be gated on cartHydrated');
  });

  it('G: header cart badges (home, product detail) gate on cartHydrated', () => {
    for (const rel of ['app/(tabs)/index.tsx', 'app/product/[id].tsx']) {
      const src = readAppSource(rel);
      // Every badge conditional that reads totalItems must be hydration-gated.
      const badgeConds = src.match(/\{[^{}]*totalItems\s*>\s*0\s*&&/g) ?? [];
      assert.ok(badgeConds.length > 0, `${rel}: expected a cart badge conditional`);
      for (const cond of badgeConds) {
        assert.match(cond, /cartHydrated\s*&&\s*totalItems/,
          `${rel}: cart badge must be gated on cartHydrated (found: ${cond.trim()})`);
      }
    }
  });

  it('H: useCartBarInset delegates hydration-aware spacing to the shared layout helper', () => {
    const src = readAppSource('hooks/useCartBarInset.ts');
    assert.match(src, /cartContentInset\(cartHydrated, totalItems, insets.bottom, fontScale\)/);
  });
});
