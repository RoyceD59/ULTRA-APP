import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STORE_CATEGORIES, visibleStoreCategory } from '@/lib/storeCategories';

describe('store category route state', () => {
  it('keeps every visible segment representable in route state', () => {
    for (const category of STORE_CATEGORIES) {
      assert.equal(visibleStoreCategory(category), category);
    }
  });

  it('maps live WooCommerce-style category labels back to a visible tab', () => {
    assert.equal(visibleStoreCategory('Portable Filters'), 'Bottles & Portable');
    assert.equal(visibleStoreCategory('Household Filters'), 'Home Filters');
    assert.equal(visibleStoreCategory('Shower Filters'), 'Shower & Skin');
    assert.equal(visibleStoreCategory('Water Treatment Solutions'), 'Solutions');
  });
});