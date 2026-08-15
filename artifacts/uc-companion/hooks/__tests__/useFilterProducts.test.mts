/**
 * Tests for useFilterProducts helpers and resolution logic.
 *
 * Covers:
 *   - toFilterProducts: lifespanDays > 0 filtering and icon derivation
 *   - readCache: returns null when empty/invalid, parsed array when valid
 *   - resolveFilterProducts: the three-tier resolution order
 *       1. Cache hit   → emits { source: 'cache' } before touching the API
 *       2. Live fetch  → emits { source: 'live' } and writes AsyncStorage
 *       3. Fallback    → when both cache and API are unavailable the caller
 *                        receives only { done: true } (static FALLBACK list)
 *   - FALLBACK_FILTER_PRODUCTS: every entry has lifespanDays > 0 and an icon
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 *
 * AsyncStorage is provided by the stub in hooks/node_modules/ — the same
 * instance the module under test imports, so _storage mutations are visible
 * to readCache / resolveFilterProducts immediately.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore — stub exports private helpers not present in real package types
import AsyncStorageStub from '@react-native-async-storage/async-storage';

const _storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const _resetStorage: () => void     = (AsyncStorageStub as any)._reset;

import {
  toFilterProducts,
  readCache,
  resolveFilterProducts,
  FALLBACK_FILTER_PRODUCTS,
  FilterProductsUpdate,
} from '../useFilterProducts.js';
import type { UCProduct } from '../useApi.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CACHE_KEY = 'uc_filter_products_cache';

function makeProduct(overrides: Partial<UCProduct> & { id: number; name: string }): UCProduct {
  return {
    id: overrides.id,
    name: overrides.name,
    price: overrides.price ?? '0',
    regularPrice: overrides.regularPrice ?? '0',
    salePrice: overrides.salePrice ?? '',
    description: overrides.description ?? '',
    shortDescription: overrides.shortDescription ?? '',
    tagline: overrides.tagline ?? '',
    categories: overrides.categories ?? [],
    images: overrides.images ?? [],
    sku: overrides.sku ?? '',
    stockStatus: overrides.stockStatus ?? 'instock',
    stockQuantity: overrides.stockQuantity ?? null,
    tags: overrides.tags ?? [],
    lifespanDays: overrides.lifespanDays,
  };
}

/** Collect all updates emitted by resolveFilterProducts into an array. */
async function collect(
  fetchProducts: () => Promise<UCProduct[]>,
): Promise<FilterProductsUpdate[]> {
  const updates: FilterProductsUpdate[] = [];
  await resolveFilterProducts(fetchProducts, u => updates.push({ ...u }));
  return updates;
}

// ── toFilterProducts ──────────────────────────────────────────────────────────

describe('toFilterProducts', () => {
  it('keeps products with a positive lifespanDays', () => {
    const result = toFilterProducts([
      makeProduct({ id: 1, name: 'Hydra Flux', lifespanDays: 90 }),
      makeProduct({ id: 2, name: 'Truva Go',   lifespanDays: 60 }),
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 1);
    assert.equal(result[1].id, 2);
  });

  it('excludes products with lifespanDays === 0', () => {
    const result = toFilterProducts([
      makeProduct({ id: 1, name: 'Accessory',  lifespanDays: 0 }),
      makeProduct({ id: 2, name: 'Hydra Flux', lifespanDays: 90 }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
  });

  it('excludes products with a negative lifespanDays', () => {
    const result = toFilterProducts([
      makeProduct({ id: 1, name: 'Bad Product', lifespanDays: -1 }),
      makeProduct({ id: 2, name: 'Good Filter', lifespanDays: 30 }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
  });

  it('excludes products where lifespanDays is undefined', () => {
    const result = toFilterProducts([
      makeProduct({ id: 1, name: 'No Lifespan' }),
      makeProduct({ id: 2, name: 'Has Lifespan', lifespanDays: 120 }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
  });

  it('returns an empty array when all products have zero or missing lifespanDays', () => {
    assert.deepEqual(toFilterProducts([
      makeProduct({ id: 1, name: 'Acc A', lifespanDays: 0 }),
      makeProduct({ id: 2, name: 'Acc B' }),
    ]), []);
  });

  it('maps id, name, and lifespanDays correctly onto FilterProduct', () => {
    const [fp] = toFilterProducts([
      makeProduct({ id: 7, name: 'Survivor Straw', lifespanDays: 120 }),
    ]);
    assert.equal(fp.id, 7);
    assert.equal(fp.name, 'Survivor Straw');
    assert.equal(fp.lifespanDays, 120);
    assert.ok(typeof fp.icon === 'string' && fp.icon.length > 0);
  });

  it('assigns funnel-outline to products whose name contains "straw"', () => {
    const [fp] = toFilterProducts([makeProduct({ id: 7, name: 'Survivor Straw', lifespanDays: 120 })]);
    assert.equal(fp.icon, 'funnel-outline');
  });

  it('assigns sparkles-outline for shower/skin category products', () => {
    const [fp] = toFilterProducts([makeProduct({
      id: 15, name: "J'adore", lifespanDays: 150,
      categories: [{ id: 5, name: 'Shower Filters' }],
    })]);
    assert.equal(fp.icon, 'sparkles-outline');
  });

  it('assigns home-outline for home category products', () => {
    const [fp] = toFilterProducts([makeProduct({
      id: 11, name: 'Sweet Home', lifespanDays: 120,
      categories: [{ id: 3, name: 'Home Filters' }],
    })]);
    assert.equal(fp.icon, 'home-outline');
  });

  it('defaults to water-outline when no category pattern matches', () => {
    const [fp] = toFilterProducts([makeProduct({ id: 4, name: 'Flex', lifespanDays: 90 })]);
    assert.equal(fp.icon, 'water-outline');
  });
});

// ── readCache ─────────────────────────────────────────────────────────────────

describe('readCache', () => {
  beforeEach(() => { _resetStorage(); });

  it('returns null when the cache key is absent', async () => {
    assert.equal(await readCache(), null);
  });

  it('returns parsed array when the cache holds valid data', async () => {
    const cached = [
      { id: 1, name: 'Hydra Flux', lifespanDays: 90, icon: 'water-outline' },
      { id: 2, name: 'Truva Go',   lifespanDays: 60, icon: 'water-outline' },
    ];
    _storage.set(CACHE_KEY, JSON.stringify(cached));
    const result = await readCache();
    assert.ok(Array.isArray(result));
    assert.equal(result!.length, 2);
    assert.equal(result![0].id, 1);
  });

  it('returns null when the cache holds an empty array', async () => {
    _storage.set(CACHE_KEY, JSON.stringify([]));
    assert.equal(await readCache(), null);
  });

  it('returns null when the cache holds invalid JSON', async () => {
    _storage.set(CACHE_KEY, 'not-json{{');
    assert.equal(await readCache(), null);
  });

  it('returns null when the cache holds a non-array JSON value', async () => {
    _storage.set(CACHE_KEY, JSON.stringify({ id: 1 }));
    assert.equal(await readCache(), null);
  });
});

// ── resolveFilterProducts — resolution order ──────────────────────────────────

describe('resolveFilterProducts', () => {
  beforeEach(() => { _resetStorage(); });

  // ── Live path (no prior cache) ──────────────────────────────────────────────

  it('live path: emits source=live when the API succeeds and no cache exists', async () => {
    const apiProducts = [makeProduct({ id: 5, name: 'Timbo', lifespanDays: 90 })];
    const updates = await collect(() => Promise.resolve(apiProducts));

    const liveUpdate = updates.find(u => u.source === 'live');
    assert.ok(liveUpdate, 'a live update must be emitted');
    assert.equal(liveUpdate!.products!.length, 1);
    assert.equal(liveUpdate!.products![0].id, 5);
  });

  it('live path: writes the fetched products to AsyncStorage', async () => {
    await collect(() => Promise.resolve([
      makeProduct({ id: 5, name: 'Timbo', lifespanDays: 90 }),
    ]));
    const written = _storage.get(CACHE_KEY);
    assert.ok(written, 'cache must be written after a live fetch');
    const parsed = JSON.parse(written!);
    assert.equal(parsed[0].id, 5);
  });

  it('live path: only trackable products (lifespanDays > 0) reach the cache', async () => {
    await collect(() => Promise.resolve([
      makeProduct({ id: 1, name: 'Accessory',  lifespanDays: 0 }),
      makeProduct({ id: 2, name: 'Hydra Flux', lifespanDays: 90 }),
    ]));
    const parsed = JSON.parse(_storage.get(CACHE_KEY)!);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 2);
  });

  it('live path: always emits { done: true } as the final update', async () => {
    const updates = await collect(() => Promise.resolve([
      makeProduct({ id: 5, name: 'Timbo', lifespanDays: 90 }),
    ]));
    const last = updates[updates.length - 1];
    assert.equal(last.done, true);
  });

  // ── Cache path (API offline) ────────────────────────────────────────────────

  it('cache path: emits source=cache before attempting the API when a cache exists', async () => {
    const cached = [{ id: 9, name: 'Breeze', lifespanDays: 90, icon: 'water-outline' }];
    _storage.set(CACHE_KEY, JSON.stringify(cached));

    let cacheEmittedBeforeApi = false;
    let apiCalled = false;

    await resolveFilterProducts(
      async () => {
        apiCalled = true;
        return [];
      },
      ({ source }) => {
        if (source === 'cache' && !apiCalled) cacheEmittedBeforeApi = true;
      },
    );

    assert.ok(cacheEmittedBeforeApi, 'cache update must be emitted before the API is called');
  });

  it('cache path: emitted cache products match what was stored', async () => {
    const cached = [{ id: 9, name: 'Breeze', lifespanDays: 90, icon: 'water-outline' }];
    _storage.set(CACHE_KEY, JSON.stringify(cached));

    const updates = await collect(() => Promise.reject(new Error('offline')));

    const cacheUpdate = updates.find(u => u.source === 'cache');
    assert.ok(cacheUpdate, 'a cache update must be emitted');
    assert.equal(cacheUpdate!.products![0].id, 9);
  });

  it('cache path: source stays cache (no live update) when the API throws', async () => {
    _storage.set(CACHE_KEY, JSON.stringify([
      { id: 9, name: 'Breeze', lifespanDays: 90, icon: 'water-outline' },
    ]));

    const updates = await collect(() => Promise.reject(new Error('offline')));

    assert.ok(!updates.find(u => u.source === 'live'), 'no live update when API throws');
    assert.ok(updates.find(u => u.source === 'cache'), 'cache update still emitted');
  });

  it('cache path: done is still emitted when the API throws (loading always settles)', async () => {
    _storage.set(CACHE_KEY, JSON.stringify([
      { id: 9, name: 'Breeze', lifespanDays: 90, icon: 'water-outline' },
    ]));
    const updates = await collect(() => Promise.reject(new Error('offline')));
    assert.ok(updates.find(u => u.done), 'done must be emitted even when offline');
  });

  // ── Fallback path (no cache, no API) ────────────────────────────────────────

  it('fallback path: emits only done (no products/source update) when cache is absent and API fails', async () => {
    const updates = await collect(() => Promise.reject(new Error('offline')));

    assert.ok(!updates.find(u => u.source === 'cache'), 'no cache update when cache is absent');
    assert.ok(!updates.find(u => u.source === 'live'),  'no live update when API fails');
    // The hook starts from FALLBACK_FILTER_PRODUCTS; the caller's initial state is the fallback.
    assert.ok(updates.find(u => u.done), 'done must still be emitted');
  });

  it('fallback path: FALLBACK_FILTER_PRODUCTS is non-empty so the picker is never blank', () => {
    assert.ok(FALLBACK_FILTER_PRODUCTS.length > 0, 'fallback list must have at least one product');
  });

  // ── Cache-then-live path (online with prior cache) ──────────────────────────

  it('cache-then-live path: cache update precedes live update', async () => {
    _storage.set(CACHE_KEY, JSON.stringify([
      { id: 9, name: 'Breeze', lifespanDays: 90, icon: 'water-outline' },
    ]));

    const sources: string[] = [];
    await resolveFilterProducts(
      () => Promise.resolve([makeProduct({ id: 2, name: 'Truva Go', lifespanDays: 60 })]),
      ({ source }) => { if (source) sources.push(source); },
    );

    assert.deepEqual(sources, ['cache', 'live'], 'cache must appear before live in the update stream');
  });

  it('cache-then-live path: live update overwrites the cache in AsyncStorage', async () => {
    _storage.set(CACHE_KEY, JSON.stringify([
      { id: 9, name: 'Breeze (stale)', lifespanDays: 90, icon: 'water-outline' },
    ]));

    await collect(() => Promise.resolve([
      makeProduct({ id: 2, name: 'Truva Go', lifespanDays: 60 }),
    ]));

    const written = JSON.parse(_storage.get(CACHE_KEY)!);
    assert.equal(written.length, 1);
    assert.equal(written[0].id, 2, 'cache must be overwritten with fresh live data');
  });

  it('cache-then-live path: live products returned to caller are correct', async () => {
    _storage.set(CACHE_KEY, JSON.stringify([
      { id: 9, name: 'Breeze', lifespanDays: 90, icon: 'water-outline' },
    ]));

    const updates = await collect(() => Promise.resolve([
      makeProduct({ id: 2, name: 'Truva Go', lifespanDays: 60 }),
    ]));

    const liveUpdate = updates.find(u => u.source === 'live');
    assert.ok(liveUpdate);
    assert.equal(liveUpdate!.products![0].id, 2);
    assert.equal(liveUpdate!.products![0].lifespanDays, 60);
  });

  // ── API returns empty list ──────────────────────────────────────────────────

  it('does not emit a live update or overwrite the cache when the API returns an empty list', async () => {
    const cachedData = [{ id: 9, name: 'Breeze', lifespanDays: 90, icon: 'water-outline' }];
    _storage.set(CACHE_KEY, JSON.stringify(cachedData));

    const updates = await collect(() => Promise.resolve([]));

    assert.ok(!updates.find(u => u.source === 'live'), 'no live update for an empty API result');
    // Cache must be untouched
    const stored = JSON.parse(_storage.get(CACHE_KEY)!);
    assert.equal(stored[0].id, 9, 'existing cache must not be replaced with an empty list');
  });
});

// ── FALLBACK_FILTER_PRODUCTS sanity ──────────────────────────────────────────

describe('FALLBACK_FILTER_PRODUCTS', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(FALLBACK_FILTER_PRODUCTS) && FALLBACK_FILTER_PRODUCTS.length > 0);
  });

  it('every entry has lifespanDays > 0', () => {
    for (const fp of FALLBACK_FILTER_PRODUCTS) {
      assert.ok(fp.lifespanDays > 0, `"${fp.name}" has lifespanDays=${fp.lifespanDays}`);
    }
  });

  it('every entry has a non-empty icon string', () => {
    for (const fp of FALLBACK_FILTER_PRODUCTS) {
      assert.ok(typeof fp.icon === 'string' && fp.icon.length > 0, `"${fp.name}" is missing icon`);
    }
  });

  it('all ids are unique', () => {
    const ids = FALLBACK_FILTER_PRODUCTS.map(fp => fp.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
