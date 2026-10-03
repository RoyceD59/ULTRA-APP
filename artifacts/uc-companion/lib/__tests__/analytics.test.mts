import assert from 'node:assert/strict';
import test from 'node:test';
import { __setPlatform } from 'react-native';
import { ANALYTICS_EVENT_NAMES, trackEvent } from '../analytics';

test('analytics exposes only the privacy-safe event contract', () => {
  assert.deepEqual([...ANALYTICS_EVENT_NAMES], [
    'water_check_started',
    'water_check_completed',
    'guide_list_viewed',
    'guide_opened',
    'guide_media_started',
    'guide_media_completed',
    'guide_media_failed',
    'signup_completed',
    'product_viewed',
    'cart_item_added',
    'checkout_started',
    'order_submitted',
    'review_submitted',
    'support_ticket_submitted',
    'alison_message_sent',
    'alison_reply_received',
    'article_opened',
    'article_source_clicked',
    'wishlist_item_added',
    'wishlist_item_removed',
  ]);
});

test('article and wishlist dimensions exclude link text, URLs, titles and customer identity', () => {
  __setPlatform('web');
  const calls: unknown[] = [];
  Object.assign(globalThis, { window: { umami: { track: (...args: unknown[]) => calls.push(args) } } });
  trackEvent('article_opened', { articleId: 'article-123', title: 'Private draft' } as never);
  trackEvent('article_source_clicked', {
    articleId: 'article-123', placement: 'body', url: 'https://example.test/?token=private', text: 'Private link',
  } as never);
  trackEvent('article_source_clicked', { articleId: 'article-123', placement: 'sources' });
  trackEvent('wishlist_item_added', { productId: 12, customerId: 9 } as never);
  trackEvent('wishlist_item_removed', { productId: 12, name: 'Private name' } as never);
  assert.deepEqual(calls, [
    ['article_opened', { articleId: 'article-123' }],
    ['article_source_clicked', { articleId: 'article-123', placement: 'body' }],
    ['article_source_clicked', { articleId: 'article-123', placement: 'sources' }],
    ['wishlist_item_added', { productId: 12 }],
    ['wishlist_item_removed', { productId: 12 }],
  ]);
  trackEvent('article_opened', { articleId: 'private@example.test' });
  trackEvent('article_source_clicked', { articleId: 'article-123', placement: 'private text' } as never);
  trackEvent('wishlist_item_added', { productId: -1 });
  assert.equal(calls.length, 5);
  __setPlatform('android');
  trackEvent('article_opened', { articleId: 'article-123' });
  trackEvent('wishlist_item_removed', { productId: 12 });
  assert.equal(calls.length, 5);
  delete (globalThis as { window?: unknown }).window;
});

test('analytics forwards only runtime-allowlisted properties and remains safe when absent', () => {
  __setPlatform('web');
  const calls: unknown[] = [];
  Object.assign(globalThis, {
    window: { umami: { track: (...args: unknown[]) => calls.push(args) } },
  });
  trackEvent('signup_completed', { countryCode: 'KE' });
  trackEvent('cart_item_added', {
    productId: 27,
    quantity: 2,
    customerEmail: 'private@example.test',
    productName: 'private item',
  } as never);
  trackEvent('review_submitted', {
    rating: 5,
    photoCount: 2,
    videoCount: 0,
    reviewText: 'private review',
  } as never);
  trackEvent('alison_message_sent');
  assert.deepEqual(calls, [
    ['signup_completed', { countryCode: 'KE' }],
    ['cart_item_added', { productId: 27, quantity: 2 }],
    ['review_submitted', { rating: 5, photoCount: 2, videoCount: 0 }],
    ['alison_message_sent', undefined],
  ]);
  assert.doesNotThrow(() => trackEvent('cart_item_added', { productId: 0, quantity: 1 } as never));
  assert.equal(calls.length, 4);
  delete (globalThis as { window?: unknown }).window;
  __setPlatform('ios');
  assert.doesNotThrow(() => trackEvent('water_check_started', { countryCode: 'KE' }));
});

test('native platforms and missing trackers are no-ops; sync and async tracker errors are swallowed', async () => {
  const calls: unknown[] = [];
  __setPlatform('android');
  Object.assign(globalThis, { window: { umami: { track: (...args: unknown[]) => calls.push(args) } } });
  trackEvent('product_viewed', { productId: 10 });
  assert.deepEqual(calls, []);

  __setPlatform('web');
  Object.assign(globalThis, { window: { umami: { track: () => { throw new Error('sync analytics error'); } } } });
  assert.doesNotThrow(() => trackEvent('product_viewed', { productId: 10 }));

  Object.assign(globalThis, {
    window: { umami: { track: () => Promise.reject(new Error('async analytics error')) } },
  });
  assert.doesNotThrow(() => trackEvent('product_viewed', { productId: 10 }));
  await new Promise(resolve => setImmediate(resolve));

  delete (globalThis as { window?: unknown }).window;
  assert.doesNotThrow(() => trackEvent('product_viewed', { productId: 10 }));
  assert.doesNotThrow(() => trackEvent('alison_reply_received'));
  __setPlatform('ios');
});