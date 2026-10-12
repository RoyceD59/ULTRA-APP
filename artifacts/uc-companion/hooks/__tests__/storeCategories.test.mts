import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STORE_CATEGORIES, visibleStoreCategory } from '@/lib/storeCategories';

describe('store category route state', () => {
  it('keeps every visible segment representable in route state', () => {
    for (const category of STORE_CATEGORIES) {
      assert.equal(visibleStoreCategory(category), category);
    }
  });

  it('maps legacy storefront labels back to a visible tab', () => {
    assert.equal(visibleStoreCategory('Portable Filters'), 'Bottles & On-the-Go');
    assert.equal(visibleStoreCategory('Household Filters'), 'Home & Kitchen');
    assert.equal(visibleStoreCategory('Shower Filters'), 'Skincare & Wellness');
    assert.equal(visibleStoreCategory('Water Treatment Solutions'), 'Business & Community');
  });

  it('places every authored product record under a visible tab', async () => {
    const { createRequire } = await import('node:module');
    const { records } = createRequire(import.meta.url)('../../server/product-records.cjs');
    for (const product of records.products) {
      assert.notEqual(visibleStoreCategory(product.category), null, `${product.code}: ${product.category}`);
      assert.notEqual(visibleStoreCategory(product.category), 'All');
    }
  });
});
