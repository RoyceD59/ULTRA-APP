import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';

// Run through the staged API's isolated test runner, never against app data.
const database = new URL(process.env.DATABASE_URL ?? 'http://missing');
assert.match(database.pathname, /^\/test_api_\d+_\d+$/);
assert.equal(process.env.NODE_ENV, 'test');
const apiRoot = process.cwd();
assert.match(apiRoot, /\.consistency-build\/[a-f0-9]{64}\/artifacts\/api-server$/);
const load = (path: string) => import(pathToFileURL(resolve(apiRoot, path)).href);
const require = createRequire(resolve(apiRoot, 'package.json'));
const express = require('express');
const { pool } = await load('../../lib/db/src/index.ts');
const editorial = await load('src/lib/product-editorial.ts');
const catalogue = await load('src/lib/companion-catalogue.ts');
const realFetch = globalThis.fetch;
let server: Server;
let base: string;
let products: any[];
let uc: any;
let outbound = 0;

before(async () => {
  // No real provider is reachable, even if the workspace has credentials.
  for (const name of Object.keys(process.env)) {
    if (/^(WC_|MPESA_|PAYSTACK_|STRIPE_)/.test(name)) delete process.env[name];
  }
  await editorial.ensureProductEditorialSchema();
  await catalogue.ensureCompanionCatalogueSchema();
  products = await catalogue.companionCatalogue(true);
  uc = await load('src/routes/uc.ts');
  const records = await load('src/routes/uc-product-records.ts');
  const rewards = await load('src/routes/uc-rewards.ts');
  const app = express();
  app.use(express.json(), records.default, rewards.default, uc.default);
  server = app.listen(0);
  await new Promise<void>(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  globalThis.fetch = (async (input: any, init: any) => {
    if (!String(input?.url ?? input).startsWith(base)) {
      outbound++;
      throw new Error('External requests forbidden in release fixture');
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>(r => server.close(() => r()));
  await pool.end();
});
const request = (path: string, body?: unknown, authorization?: string) =>
  realFetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('only three approved pages activate, with exact galleries and shared identities', async () => {
  const response = await request('/uc/product-records');
  assert.equal(response.status, 200);
  const list = await response.json() as any;
  assert.deepEqual(list.products.map((p: any) => p.code).sort(), ['FCT', 'GMB', 'VDR']);
  for (const [code, slots] of Object.entries({ FCT: [1, 2, 3, 5], VDR: [1, 2, 3, 4, 5], GMB: [1, 2, 3, 4, 5, 6] })) {
    const record = list.products.find((p: any) => p.code === code);
    const detailResponse = await request('/uc/product-records/' + record.slug);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as any;
    assert.equal(detail.commerceId, products.find(p => p.code === code && !p.parent_id).id);
    assert.deepEqual(detail.images.map((p: any) => p.slot), slots);
    assert.ok(detail.images.every((p: any) => p.alt && /^\/api\//.test(p.src)));
    const legacyResponse = await request('/uc/products/' + detail.commerceId);
    assert.equal(legacyResponse.status, 200);
    const legacy = await legacyResponse.json() as any;
    assert.equal(legacy.sku, detail.parentSku);
    assert.equal(Number(legacy.price), detail.price);
  }
  const other = products.find(p => !p.parent_id && !['FCT', 'GMB', 'VDR'].includes(p.code));
  assert.equal((await request('/uc/product-records/' + other.sku)).status, 404);
  assert.equal(outbound, 0);
});

test('variant quote validates owned stock/SKU and uses server prices, without providers', async () => {
  const parent = products.find(p => p.code === 'FCT' && !p.parent_id);
  const child = products.find(p => p.parent_id === parent.id);
  assert.ok(child);
  const line = { productId: parent.id, variationId: child.id, childSku: child.sku, quantity: 1 };
  assert.equal(await uc.serverPricedLines([line]), null, 'unknown stock must not authorize buying');
  await catalogue.updateCompanionInventory(child.id, { stock_quantity: 2, stock_status: 'instock' }, 'test-fixture');
  uc.invalidateCatalogueCache();
  const good = await request('/uc/checkout/quote', { fulfillment: 'collection', lineItems: [line], total: 1 });
  assert.equal(good.status, 200);
  const quote = await good.json() as any;
  assert.equal(quote.lines[0].childSku, child.sku);
  assert.equal(quote.delivery, 0);
  assert.equal(quote.total, quote.lines[0].subtotal);
  assert.ok(quote.total > 1);
  const wrong = await request('/uc/checkout/quote', { fulfillment: 'collection', lineItems: [{ ...line, childSku: 'unrelated-sku' }] });
  assert.equal(wrong.status, 422);
  const delivery = await request('/uc/checkout/quote', { fulfillment: 'delivery', lineItems: [line] });
  assert.equal(delivery.status, 200);
  assert.equal((await delivery.json() as any).total, quote.total + 500);
  assert.equal(outbound, 0);
});

test('recovery endpoints exist and reject invalid authentication or keys', async () => {
  assert.equal((await request('/uc/checkout/recovery?idempotencyKey=short')).status, 400);
  assert.equal((await request('/uc/checkout/recovery?idempotencyKey=release-fixture', undefined, 'Bearer invalid')).status, 401);
  assert.equal((await request('/uc/checkout/cancel', { idempotencyKey: 'short' })).status, 400);
  assert.equal((await request('/uc/checkout/cancel', { idempotencyKey: 'release-fixture' }, 'Bearer invalid')).status, 401);
  assert.equal(outbound, 0);
});

test('cart persists variants separately and sends matching checkout identities', async () => {
  const cart = await load('../uc-companion/context/cartStorage.ts');
  const first = { id: 1000000, name: 'Test product', price: 3299, quantity: 1,
    variationId: 1000001, childSku: 'TEST-BLUE', variantLabel: 'Blue', image: '' };
  const second = { ...first, variationId: 1000002, childSku: 'TEST-WHITE', variantLabel: 'White' };
  let items = cart.mergeItem([], first);
  items = cart.mergeItem(items, second);
  items = cart.mergeItem(items, first);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((p: any) => p.quantity), [2, 1]);
  let stored = '';
  const storage = {
    getItem: async () => stored,
    setItem: async (_key: string, value: string) => { stored = value; },
    removeItem: async () => { stored = ''; },
  };
  await cart.saveCartToStorage(storage, items);
  const restored = await cart.loadCartFromStorage(storage);
  assert.deepEqual(restored, items);
  assert.deepEqual(cart.checkoutLine(restored[0]), {
    productId: first.id, quantity: 2, variationId: first.variationId, childSku: first.childSku,
  });
  assert.equal(cart.totalPrice(restored), 3299 * 3);
});
