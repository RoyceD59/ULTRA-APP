import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

describe('Wishlist out-of-stock action selection and state scoping', () => {
  it('ProductCard triggers onToggleWishlist without propagating up to the card onPress', async () => {
    const source = await readFile(new URL('../../components/ProductCard.tsx', import.meta.url), 'utf8');
    
    // Check that grid layout Notify me button triggers onToggleWishlist
    assert.match(source, /<TouchableOpacity[^>]*onPress=\{onToggleWishlist\}[^>]*>/);
    // Check accessibility label semantic is mapped correctly
    assert.match(source, /accessibilityLabel=\{isWishlisted \? "Restock alert on" : "Notify me"\}/);
  });

  it('keeps wishlist invalidation tied to the customer that initiated it in catalog', async () => {
    const source = await readFile(new URL('../../app/(tabs)/products.tsx', import.meta.url), 'utf8');

    // Ensure wishlist toggle in catalog invalidates customer-scoped key
    assert.match(source, /invalidateQueries\(\{ queryKey: customerQueryKeys\.wishlist\(initiatingCustomerId\) \}\)/);
    // Ensure wishlist queries are scoped by user id
    assert.match(source, /queryKey: customerQueryKeys\.wishlist\(user\?\.id\)/);
  });

  it('keeps wishlist invalidation tied to the customer that initiated it in product detail', async () => {
    const source = await readFile(new URL('../../app/product/[id].tsx', import.meta.url), 'utf8');

    assert.match(source, /invalidateQueries\(\{ queryKey: customerQueryKeys\.wishlist\(initiatingCustomerId\) \}\)/);
    assert.match(source, /queryKey: customerQueryKeys\.wishlist\(user\?\.id\)/);
  });
});
