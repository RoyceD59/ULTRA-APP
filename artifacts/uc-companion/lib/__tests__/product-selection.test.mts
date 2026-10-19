import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from 'react-native';
import { mergeItem, cartLineKey, checkoutLine, loadCartFromStorage, saveCartToStorage } from '../../context/cartStorage';
import { quoteMatchesCheckout, checkoutLineSubtotal } from '../../hooks/checkoutQuoteIdentity';
import { configureGoogleProductAnalytics, configureProductAnalytics, trackProductEvent, trackVerifiedPurchase } from '../productAnalytics';
import { purchaseState, productShareUrl, shareText, whatsappUrl, type ProductRecord } from '../productRecord';

test('different real children persist separately; legacy parent carts are still readable', async () => {
  const legacy = { id: 12, name: 'Bottle', price: 4199, quantity: 1, image: '', sku: 'PARENT' };
  const a = { ...legacy, variationId: 101, childSku: 'CHILD-A', variantLabel: 'Blue' };
  const b = { ...legacy, variationId: 102, childSku: 'CHILD-B', variantLabel: 'Red' };
  const items = mergeItem(mergeItem(mergeItem([legacy], a), b), a);
  assert.equal(items.length, 3);
  assert.equal(items.find(i => i.childSku === 'CHILD-A')?.quantity, 2);
  assert.notEqual(cartLineKey(a), cartLineKey(b));
  let stored = '';
  const storage = { getItem: async () => stored, setItem: async (_: string, v: string) => { stored = v; }, removeItem: async () => { stored = ''; } };
  await saveCartToStorage(storage, items);
  assert.deepEqual(await loadCartFromStorage(storage), items);
  assert.deepEqual(checkoutLine(a), { productId: 12, quantity: 1, variationId: 101, childSku: 'CHILD-A' });
  assert.deepEqual(checkoutLine(legacy), { productId: 12, quantity: 1 });
  assert.equal(quoteMatchesCheckout({ fulfillment: 'collection', lines: [checkoutLine(a)] },
    { fulfillment: 'collection', lineItems: [checkoutLine(b)], applyReferralDiscount: false }), false);
});

test('selection gates do not invent price or stock; null prices use enquiry; out-of-stock remains wishlist eligible', () => {
  const r = { purchasable: true, price: 4199, operation: { commerceId: 12, livePrice: 4199,
    availability: 'instock', images: [], variants: [], diagnostics: [] } } as unknown as ProductRecord;
  assert.equal(purchaseState(r, null).kind, 'buy');
  assert.equal(purchaseState({ ...r, price: null }, null).kind, 'enquiry');
  assert.equal(purchaseState({ ...r, operation: { ...r.operation, availability: null } }, null).kind, 'blocked');
  assert.equal(purchaseState({ ...r, operation: { ...r.operation, livePrice: 4200 } }, null).kind, 'blocked');
  const child = { childSku: 'CHILD-A', label: 'Blue', variationId: 101, price: 4199, stockStatus: 'instock' };
  const v = { ...r, operation: { ...r.operation, variants: [child] } };
  assert.equal(purchaseState(v, null).kind, 'blocked');
  assert.equal(purchaseState(v, child).kind, 'buy');
  assert.equal(purchaseState(v, { ...child, variationId: null }).kind, 'blocked');
  assert.equal(purchaseState(v, { ...child, stockStatus: 'outofstock', diagnostic: 'price-mismatch' }).kind, 'out_of_stock');
});

test('checkout summary amounts belong to the exact variant and quantity, not the shared parent', () => {
  const a = { id: 12, quantity: 2, price: 1, variationId: 101, childSku: 'CHILD-A' };
  const b = { id: 12, quantity: 1, price: 1, variationId: 102, childSku: 'CHILD-B' };
  const quote = { lines: [
    { productId: 12, quantity: 2, variationId: 101, childSku: 'CHILD-A', subtotal: 8798 },
    { productId: 12, quantity: 1, variationId: 102, childSku: 'CHILD-B', subtotal: 4399 },
  ] };
  assert.equal(checkoutLineSubtotal(a, quote, true), 8798);
  assert.equal(checkoutLineSubtotal(b, quote, true), 4399);
  assert.equal(checkoutLineSubtotal(a, quote, false), 2);
  assert.equal(checkoutLineSubtotal({ ...b, childSku: 'OTHER' }, quote, true), 1);
});

test('approved Companion prices supersede Woo reference prices without bypassing live stock or identity', () => {
  const child = { childSku: 'CHILD-A', label: 'Blue', variationId: 101, price: 4399, stockStatus: 'instock' };
  const r = { purchasable: true, price: 4399, operation: {
    commerceId: 12, livePrice: 1, priceAuthority: 'companion', availability: 'instock',
    images: [], variants: [child], diagnostics: ['commerce-price-differs-from-approved'],
  } } as unknown as ProductRecord;
  assert.deepEqual(purchaseState(r, child), { kind: 'buy', price: 4399 });
  assert.equal(purchaseState({ ...r, operation: { ...r.operation, variants: [] } }, null).kind, 'buy');
  assert.equal(purchaseState(r, { ...child, stockStatus: 'outofstock' }).kind, 'out_of_stock');
  assert.equal(purchaseState(r, { ...child, stockStatus: null }).kind, 'blocked');
  assert.equal(purchaseState(r, { ...child, variationId: null }).kind, 'blocked');
  assert.equal(purchaseState({ ...r, operation: { ...r.operation, diagnostics: ['commerce-variant-ambiguous'] } }, child).kind, 'blocked');
  assert.equal(purchaseState({ ...r, operation: { ...r.operation, priceAuthority: undefined } }, child).kind, 'blocked');
});

test('plain product sharing preserves child SKU and artifact path, with a single WhatsApp encoding', () => {
  const oldPlatform = Platform.OS; Platform.OS = 'web';
  (globalThis as any).window = { location: { origin: 'https://preview.example.test' } };
  (globalThis as any).document = { querySelector: () => ({ content: '/companion/public-page-meta' }) };
  try {
    const url = productShareUrl('hydra-flux', 'CHILD-BLUE', 'whatsapp')!;
    assert.equal(new URL(url).pathname, '/companion/product/hydra-flux');
    assert.equal(new URL(url).searchParams.get('sku'), 'CHILD-BLUE');
    assert.equal(new URL(url).searchParams.get('utm_source'), 'share');
    assert.equal(new URL(url).searchParams.get('utm_medium'), 'whatsapp');
    const plain = shareText('Hydra Flux', url);
    assert.ok(plain.includes('not a payment link'));
    assert.equal(new URL(whatsappUrl(plain)).searchParams.get('text'), plain);
  } finally { Platform.OS = oldPlatform; delete (globalThis as any).window; delete (globalThis as any).document; }
});

test('Google adapter is opt-in, privacy filtered, native silent, and purchases require verified payment and dedupe', () => {
  const old = Platform.OS; Platform.OS = 'web';
  const events: any[] = [];
  try {
    configureProductAnalytics(null);
    trackProductEvent('view_item', { productId: 12 });
    assert.equal(events.length, 0);
    configureGoogleProductAnalytics('G-FIXTURE', (...args: any[]) => events.push(args));
    trackProductEvent('share', { productId: 12, sku: 'CHILD-A', method: 'whatsapp', phone: 'PRIVATE', address: 'PRIVATE', token: 'PRIVATE' } as any);
    assert.equal(events[0][1], 'share');
    assert.ok(!JSON.stringify(events).includes('PRIVATE'));
    trackVerifiedPurchase(false, { transactionId: 'UC-110', value: 4199 });
    assert.equal(events.length, 1);
    trackVerifiedPurchase(true, { transactionId: 'UC-110', value: 4199 });
    trackVerifiedPurchase(true, { transactionId: 'UC-110', value: 4199 });
    assert.equal(events.length, 2);
    assert.equal(events[1][2].transaction_id, 'UC-110');
    Platform.OS = 'android'; trackProductEvent('view_item', { productId: 12 });
    assert.equal(events.length, 2);
  } finally { Platform.OS = old; configureProductAnalytics(null); }
});
