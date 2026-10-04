import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { __setPlatform } from 'react-native';
import { trackEvent } from '../analytics';
import { createWebAnalyticsLoader, sanitizeTrackerMetadata, UMAMI_COLLECT_URL, UMAMI_WEBSITE_ID } from '../umamiWeb';

function fixture(hostname = 'app.ucfilters.com', doNotTrack = '0') {
  const requests: Array<{ url: string; options: RequestInit; body: any }> = [];
  let replitCalls = 0;
  const browser = {
    location: { hostname, pathname: '/product/42' },
    navigator: { doNotTrack },
    document: {},
    umami: { track() { replitCalls++; } },
    companionUmami: undefined as Window['companionUmami'],
    fetch: async (url: string, options: RequestInit) => {
      requests.push({ url, options, body: JSON.parse(String(options.body)) });
      return { ok: true };
    },
  };
  const loader = createWebAnalyticsLoader(() => browser as unknown as Window);
  return { browser, requests, loader, replitCalls: () => replitCalls };
}

test('dedicated collector ignores and preserves an existing Replit tracker', async () => {
  const { browser, loader, requests, replitCalls } = fixture();
  const replitTracker = browser.umami;
  assert.equal(loader.initialize(), true);
  const ownTracker = browser.companionUmami;
  loader.initialize();
  assert.equal(browser.companionUmami, ownTracker);
  await ownTracker!.track('product_viewed', { productId: 42 });
  assert.equal(browser.umami, replitTracker);
  assert.equal(replitCalls(), 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, UMAMI_COLLECT_URL);
  assert.deepEqual(requests[0].body, {
    type: 'event',
    payload: {
      website: UMAMI_WEBSITE_ID, hostname: 'app.ucfilters.com',
      url: '/events/product_viewed', referrer: '', title: 'Ultra-Clear Companion',
      name: 'product_viewed', data: { productId: 42 },
    },
  });
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
  assert.ok(requests[0].options.signal);
});

test('native/server, preview domains, Do Not Track and disabled collection remain no-ops', () => {
  assert.equal(createWebAnalyticsLoader(() => undefined).initialize(), false);
  for (const host of ['localhost', 'preview.replit.dev', 'api.ucfilters.com']) {
    const { loader, browser } = fixture(host);
    assert.equal(loader.initialize(), false);
    assert.equal(browser.companionUmami, undefined);
  }
  for (const value of ['1', 'yes']) {
    assert.equal(fixture('app.ucfilters.com', value).loader.initialize(), false);
  }
  const { browser, loader } = fixture();
  Object.assign(browser, { localStorage: { getItem: () => '1' } });
  assert.equal(loader.initialize(), false);
  const layout = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /if \(Platform\.OS === 'web'\) webAnalyticsLoader\.initialize\(\)/);
});

test('product and checkout events flow through the privacy wrapper, never the Replit collector', async () => {
  __setPlatform('web');
  const { browser, requests, replitCalls } = fixture();
  Object.assign(globalThis, { window: browser });
  try {
    trackEvent('product_viewed', { productId: 42, email: 'private@example.test' } as never);
    browser.location.pathname = '/checkout';
    trackEvent('checkout_started', { itemCount: 2, customerId: 99, phone: 'private' } as never);
    assert.deepEqual(requests.map(r => [r.body.payload.name, r.body.payload.data]), [
      ['product_viewed', { productId: 42 }], ['checkout_started', { itemCount: 2 }],
    ]);
    assert.equal(requests[1].body.payload.url, '/events/checkout_started');
    assert.equal(replitCalls(), 0);
    __setPlatform('ios');
    trackEvent('checkout_started', { itemCount: 2 });
    __setPlatform('android');
    trackEvent('product_viewed', { productId: 42 });
    assert.equal(requests.length, 2);
  } finally {
    delete (globalThis as { window?: unknown }).window;
    __setPlatform('web');
  }
});

test('blocked and failed requests neither retry nor fall back to Replit', async () => {
  for (const failure of ['sync', 'async', 'http'] as const) {
    const { browser, loader, replitCalls } = fixture();
    let requests = 0;
    browser.fetch = async () => {
      requests++;
      if (failure === 'http') return { ok: false };
      throw new Error('collector unavailable');
    };
    if (failure === 'sync') browser.fetch = () => { requests++; throw new Error('blocked'); };
    loader.initialize();
    await browser.companionUmami!.track('checkout_started', { itemCount: 1 });
    assert.equal(requests, 1);
    assert.equal(replitCalls(), 0);
  }
});

test('pending requests are capped and discarded, not persisted or replayed', async () => {
  const { browser, loader } = fixture();
  const finish: Array<() => void> = [];
  browser.fetch = () => new Promise(resolve => finish.push(() => resolve({ ok: true })));
  loader.initialize();
  const pending = Array.from({ length: 75 }, () => browser.companionUmami!.track('product_viewed', { productId: 42 }));
  assert.equal(finish.length, 50);
  finish.forEach(resolve => resolve());
  await Promise.all(pending);
  assert.equal(finish.length, 50);
});

test('privacy changes and storage failures are honored after initialization', async () => {
  const { browser, loader, requests } = fixture();
  loader.initialize();
  browser.navigator.doNotTrack = '1';
  await browser.companionUmami!.track('product_viewed', { productId: 42 });
  assert.equal(requests.length, 0);
  browser.navigator.doNotTrack = '0';
  Object.assign(browser, { localStorage: { getItem() { throw new Error('storage blocked'); } } });
  await browser.companionUmami!.track('product_viewed', { productId: 42 });
  assert.equal(requests.length, 0);
  assert.equal(loader.initialize(), false);
});

test('metadata scrubs query/hash, referring paths and private document titles', () => {
  assert.deepEqual(sanitizeTrackerMetadata('event', {
    url: '/auth/reset-password?resetToken=private#secret',
    referrer: 'https://example.test/private-person?email=private#secret',
    title: 'Private customer title', name: 'article_opened', data: { articleId: '123' },
  }), {
    url: '/auth/reset-password',
    referrer: 'https://example.test',
    title: 'Ultra-Clear Companion', name: 'article_opened', data: { articleId: '123' },
  });
});