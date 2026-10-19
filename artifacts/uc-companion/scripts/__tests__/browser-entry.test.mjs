import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { browserEntryRedirect } = createRequire(import.meta.url)('../../server/browser-entry.cjs');
const alias = 'team-horizon--jerryaroyce.replit.app';
const request = (headers = {}, method = 'GET') => ({
  method,
  headers: { host: alias, accept: 'text/html', ...headers },
});

describe('canonical Companion browser entry', () => {
  it('moves alias document entries to canonical root routes, preserving the query', () => {
    assert.equal(browserEntryRedirect(request(), '/', '?ref=shop'), 'https://app.ucfilters.com/?ref=shop');
    assert.equal(browserEntryRedirect(request(), '/cart', '?from=product'), 'https://app.ucfilters.com/cart?from=product');
    assert.equal(browserEntryRedirect(request(), '/auth/reset-password', '?resetToken=test'), 'https://app.ucfilters.com/auth/reset-password?resetToken=test');
  });
  it('does not loop when the custom host is carried through the proxy', () => {
    for (const header of ['host', 'x-forwarded-host', 'x-uc-public-host']) {
      assert.equal(browserEntryRedirect(request({ [header]: 'app.ucfilters.com' }), '/cart', ''), null);
    }
  });
  it('does not move native manifests, health checks, assets, API calls or development', () => {
    for (const pathname of ['/manifest', '/status', '/bundle-status', '/1790944545586-263/_expo/static/js/web/bundle.js']) {
      assert.equal(browserEntryRedirect(request(), pathname, ''), null);
    }
    assert.equal(browserEntryRedirect(request({ 'expo-platform': 'ios' }), '/', ''), null);
    assert.equal(browserEntryRedirect(request({ 'expo-platform': 'android' }), '/', ''), null);
    assert.equal(browserEntryRedirect(request({ accept: 'application/json' }), '/products', ''), null);
    assert.equal(browserEntryRedirect(request({}, 'POST'), '/checkout', ''), null);
    assert.equal(browserEntryRedirect(request({ host: 'localhost:3000' }), '/cart', ''), null);
    assert.equal(browserEntryRedirect(request({ host: 'fake.replit.app.evil.test' }), '/cart', ''), null);
  });
});