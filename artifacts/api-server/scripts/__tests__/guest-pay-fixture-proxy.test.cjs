'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const origin = 'https://fixture-test.replit.dev';
const control = { instance: '00000000-0000-4000-8000-000000000001',
  mode: 'mpesa-sandbox', publicOrigin: origin, basePath: '/api/guest-pay-fixture' };
const health = { ...control, isolated: true, syntheticData: true,
  originalBuyerRetained: true, orders: 1, buyers: 1, providersEnabled: true,
  notificationsEnabled: false, analyticsEnabled: false, simulationsEnabled: false, paymentsEnabled: false };
async function harness(options = {}) {
  const { createDevelopmentFixtureProxy } = await import('../../src/dev/guest-pay-fixture-proxy.ts');
  const app = express(), calls = [], logs = [];
  app.use('/api/guest-pay-fixture', createDevelopmentFixtureProxy({
    env: { NODE_ENV: 'development', REPLIT_DEV_DOMAIN: 'fixture-test.replit.dev' },
    getControl: async () => control,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return url.endsWith('/_fixture/health') ? Response.json(health) : new Response('<html>test</html>', {
        headers: { 'content-type': 'text/html', 'content-security-policy': "connect-src 'self'" },
      });
    }, record: fields => logs.push(fields), ...options,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/api/guest-pay-fixture`,
    calls, logs, close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}
test('production and deployed processes reject fixture namespace without contacting the worker', async () => {
  for (const env of [{ NODE_ENV: 'production', REPLIT_DEV_DOMAIN: 'fixture-test.replit.dev' },
    { NODE_ENV: 'development', REPLIT_DEV_DOMAIN: 'fixture-test.replit.dev', REPLIT_DEPLOYMENT: '1' }]) {
    const h = await harness({ env });
    try { assert.equal((await fetch(h.url + '/status')).status, 404); assert.equal(h.calls.length, 0); }
    finally { await h.close(); }
  }
});
test('foreign origins, arbitrary API paths and encoded traversal never fall through to normal checkout', async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(h.url + '/pay', { headers: { origin: 'https://foreign.example' } })).status, 403);
    for (const route of ['/api/uc/orders', '/_fixture/activate-mpesa', '/pay/%2e%2e%2f_private']) {
      assert.equal((await fetch(h.url + route)).status, 404);
    }
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});
test('missing or wrong worker attestation fails closed and preserves private headers', async () => {
  for (const options of [{ getControl: async () => null }, {
    fetchImpl: async () => Response.json({ ...health, isolated: false }),
  }]) {
    const h = await harness(options);
    try {
      const response = await fetch(h.url + '/pay');
      assert.equal(response.status, 503);
      assert.match(response.headers.get('cache-control'), /private.*no-store/);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
    } finally { await h.close(); }
  }
});
test('private page uses fixed worker destination and logs only bounded family/status, never the capability', async () => {
  const h = await harness(), token = 'test-only-capability';
  try {
    const response = await fetch(h.url + '/pay/' + token, { headers: { cookie: 'not-forwarded', authorization: 'not-forwarded' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), "connect-src 'self'");
    assert.equal(h.calls.at(-1).url, 'http://127.0.0.1:39761/pay/' + token);
    assert.equal(h.calls.at(-1).init.headers.authorization, undefined);
    assert.equal(h.calls.at(-1).init.headers.cookie, undefined);
    assert.equal(JSON.stringify(h.logs).includes(token), false);
    assert.deepEqual(Object.keys(h.logs[0]).sort(), ['family', 'status']);
  } finally { await h.close(); }
});
test('callback POST remains scoped, while malformed/oversized private requests are rejected', async () => {
  const h = await harness();
  try {
    const callback = await fetch(h.url + '/api/payments/mpesa/callback?token=test-only', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(callback.status, 200);
    assert.equal(h.calls.at(-1).url, 'http://127.0.0.1:39761/api/payments/mpesa/callback?token=test-only');
    const invalid = await fetch(h.url + '/guest-pay/initialize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad',
    });
    assert.equal(invalid.status, 400);
    const large = await fetch(h.url + '/guest-pay/initialize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(9000) }),
    });
    assert.equal(large.status, 413);
  } finally { await h.close(); }
});
