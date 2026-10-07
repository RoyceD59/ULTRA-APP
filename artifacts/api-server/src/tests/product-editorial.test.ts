import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { createRequire } from "node:module";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { ensureProductEditorialSchema, effectiveEditorial, validateEditorial, spreadsheetRetail } from "../lib/product-editorial.js";

const require = createRequire(import.meta.url);
const { source, createRecordCollection } = require("../../../uc-companion/server/product-records.cjs");
const seed = structuredClone(source.products[0]);
seed.price_kes = spreadsheetRetail.prices[seed.parent_sku];
seed.ownership.product_price_kes = seed.price_kes;
const realFetch = globalThis.fetch;
let server: http.Server, base: string, admin: number, token: string;
let stock = "instock", price = seed.price_kes, duplicate = false;
let outboundCalls = 0;
let parentStatus = "publish";
const productId = 810024;
const variations = () => seed.variants.map((v: any, index: number) => ({
  id: 810100 + index, parent_id: productId, sku: v.child_sku, status: "publish",
  price: String(price), stock_status: stock, purchasable: true,
}));
const parent = () => ({ id: productId, sku: seed.parent_sku, name: seed.name, type: "variable",
  status: parentStatus, price: String(price), stock_status: stock, categories: [], images: [
    { id: 1001, src: "https://example.test/product-real.png", alt: "Real product front" },
  ] });

before(async () => {
  process.env.WC_CONSUMER_KEY = "fixture";
  process.env.WC_CONSUMER_SECRET = "fixture";
  process.env.SESSION_SECRET = "product-editorial-fixture-secret-not-a-credential";
  delete process.env.MPESA_CONSUMER_KEY; delete process.env.MPESA_CONSUMER_SECRET;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === "string" ? input : input.url || String(input));
    const path = url.pathname;
    // Framework/auth/database probes also use fetch; only commerce pricing,
    // fulfillment and money-provider calls are prohibited by this assertion.
    if (/\/wc\/v3\/(?:products|orders)(?:\/|$)/.test(path) ||
      /(?:paystack|safaricom|stripe)/.test(url.hostname)) outboundCalls++;
    if (path.endsWith(`/products/${productId}/variations`)) {
      const list = variations();
      return Response.json(duplicate ? [...list, { ...list[0], id: 910100 }] : list);
    }
    const variation = path.match(/\/variations\/(\d+)$/);
    if (variation) return Response.json(variations().find((v: any) => String(v.id) === variation[1]));
    if (path.endsWith(`/products/${productId}`)) return Response.json(parent());
    if (path.endsWith("/products")) return Response.json([parent()]);
    throw new Error(`Unexpected outbound fixture request: ${path}`);
  }) as typeof fetch;
  await ensureProductEditorialSchema();
  admin = (await pool.query(`INSERT INTO uc_users(email,password_hash,first_name,last_name,is_admin,phone,address)
    VALUES('editorial-admin@example.test','not-a-real-password','Fixture','Editor',true,'+254700000024','Fixture collection contact') RETURNING id`)).rows[0].id;
  token = issueToken({ id: admin, email: "editorial-admin@example.test", firstName: "Fixture" });
  const { default: app } = await import("../app.js");
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (admin) await pool.query("DELETE FROM uc_users WHERE id=$1", [admin]);
  await pool.end();
});
async function request(path: string, method = "GET", body?: unknown, auth: string | null = token) {
  const r = await realFetch(`${base}${path}`, { method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() as any };
}
const adminPath = `/uc/admin/product-records/${seed.slug}`;

test("fresh seed, live admin authorization, revocation, all-record listing and media migration", async () => {
  assert.equal((await request(adminPath, "GET", undefined, null)).status, 403);
  assert.equal((await request(adminPath, "PUT", { revision: 1, record: seed }, null)).status, 403);
  assert.equal((await request("/uc/admin/product-records")).body.records.length, 21);
  const a = await request(adminPath);
  assert.equal(a.status, 200);
  assert.equal(a.body.record.price_kes, 4399, "the uploaded Excel retail value wins over the earlier brief");
  assert.equal(a.body.record.ownership.product_price_kes, 4399);
  assert.equal(a.body.record.images[0].file, "https://example.test/product-real.png");
  assert.equal(a.body.record.images[0].alt, "Real product front");
  const b = await request(adminPath);
  assert.equal(a.body.revision, b.body.revision, "migration is idempotent");
  await pool.query("UPDATE uc_users SET is_admin=false WHERE id=$1", [admin]);
  assert.equal((await request(adminPath)).status, 403);
  await pool.query("UPDATE uc_users SET is_admin=true WHERE id=$1", [admin]);
});

test("editing survives reseed and reaches initial HTML, client JSON and SEO without private data", async () => {
  const { body: current } = await request(adminPath);
  const edited = structuredClone(current);
  edited.record.seo.h1_sub = "Round-trip approved editorial subline";
  edited.record.seo.description = "Round-trip authored SEO description.";
  edited.record.internal.missing_launch_inputs.push("PRIVATE_EDITORIAL_SENTINEL");
  const saved = await request(adminPath, "PUT", edited);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.revision, current.revision + 1);
  assert.equal((await request(adminPath, "PUT", edited)).status, 409);
  await ensureProductEditorialSchema();
  assert.equal((await request(adminPath)).body.record.seo.h1_sub, edited.record.seo.h1_sub);
  const { body: publicRecord } = await request(`/uc/product-records/${seed.slug}`);
  assert.equal(publicRecord.seo.subline, edited.record.seo.h1_sub);
  assert.equal(publicRecord.seo.description, edited.record.seo.description);
  const { input, collection } = await effectiveEditorial();
  const { createPublicRenderer } = require("../../../uc-companion/server/public-rendering.cjs");
  const renderer = createPublicRenderer({ canonicalOrigin: "https://public.example.test", records: createRecordCollection(input),
    data: { editorialRecords: async () => collection, editorialProduct: async () => publicRecord } });
  const page = await renderer.render(`/product/${seed.slug}?utm_source=share&sku=${seed.variants[0].child_sku}`);
  assert.equal(page.status, 200);
  assert.ok(page.body.includes(edited.record.seo.h1_sub));
  assert.equal(page.meta.description, edited.record.seo.description);
  assert.ok(!page.meta.canonical.includes("?"));
  for (const payload of [publicRecord, collection, page.publicRecord]) {
    assert.ok(!JSON.stringify(payload).includes("PRIVATE_EDITORIAL_SENTINEL"));
    assert.ok(!JSON.stringify(payload).includes('"internal"'));
  }
});

test("contract and identity rejection includes unsafe media, evidence, safety and extra fields", async () => {
  const { body: current } = await request(adminPath);
  for (const alter of [
    (r: any) => { r.record.price_kes = "not-a-price"; },
    (r: any) => { r.record.parent_sku = "different-parent"; },
    (r: any) => { r.record.variants[0].child_sku = "different-child"; },
    (r: any) => { r.record.opening.unapproved_field = "injection"; },
    (r: any) => { r.record.images[0].file = "https://evil.example.test/photo.png"; },
    (r: any) => { r.record.images[1] = { ...r.record.images[0], slot: 1 }; },
    (r: any) => { r.record.evidence.claims[0].text = "SGS certified"; },
    (r: any) => { r.record.evidence.claims[0].text = "99% virus removal"; },
  ]) {
    const candidate = structuredClone(current); alter(candidate);
    assert.equal((await request(adminPath, "PUT", candidate)).status, 400, JSON.stringify(candidate.record.opening));
  }
  const { input } = await effectiveEditorial();
  const numberPrice = structuredClone(seed); numberPrice.price_kes = 0;
  validateEditorial(numberPrice, seed, input);
});

test("verified variation identity, independent child pricing, stock, ambiguity and parent-only refresh gate", async () => {
  const { serverPricedLines } = await import("../routes/uc.js");
  const child = seed.variants[0].child_sku;
  const lines = await serverPricedLines([{ productId, quantity: 2, variationId: 810100, childSku: child }]);
  assert.equal(lines?.[0]?.variationId, 810100);
  assert.equal(lines?.[0]?.childSku, child);
  assert.equal(lines?.[0]?.subtotal, seed.price_kes * 2);
  const quote = await request("/uc/checkout/quote", "POST", { fulfillment: "collection",
    lineItems: [{ productId, quantity: 2, variationId: 810100, childSku: child }] });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.lines[0].variationId, 810100);
  assert.equal(quote.body.lines[0].childSku, child);
  assert.equal(await serverPricedLines([{ productId, quantity: 1 }]), null);
  assert.equal(await serverPricedLines([{ productId, quantity: 1, variationId: 810100, childSku: seed.variants[1].child_sku }]), null);
  stock = "outofstock";
  assert.equal(await serverPricedLines([{ productId, quantity: 1, variationId: 810100, childSku: child }]), null);
  stock = "instock"; price = 1;
  assert.equal((await serverPricedLines([{ productId, quantity: 1, variationId: 810100, childSku: child }]))?.[0].subtotal, seed.price_kes,
    "Excel-seeded approved price supersedes WooCommerce reference price");
  const approved = (await request(`/uc/product-records/${seed.slug}`)).body;
  assert.equal(approved.price, 4399);
  assert.equal(approved.priceAuthority, "companion");
  assert.equal(approved.livePrice, 1, "raw Woo price remains truthful, not relabelled");
  assert.equal(approved.variants[0].price, 4399);
  assert.equal(approved.variants[0].commercePrice, 1);
  assert.ok(approved.diagnostics.includes("commerce-price-differs-from-approved"));
  price = seed.price_kes; duplicate = true;
  assert.equal(await serverPricedLines([{ productId, quantity: 1, variationId: 810100, childSku: child }]), null);
  duplicate = false;
});
test("an unpublished parent with a published child cannot be quoted or prepared for payment", async () => {
  const { prepareCheckoutOrder } = await import("../lib/checkout-orders.js");
  const lineItems = [{ productId, quantity: 1, variationId: 810100, childSku: seed.variants[0].child_sku }];
  const before = Number((await pool.query("SELECT count(*) FROM uc_orders WHERE user_id=$1", [String(admin)])).rows[0].count);
  parentStatus = "draft";
  try {
    assert.equal(variations()[0].status, "publish");
    const quote = await request("/uc/checkout/quote", "POST", { fulfillment: "collection", lineItems });
    assert.equal(quote.status, 422);
    await assert.rejects(() => prepareCheckoutOrder({ fulfillment: "collection", lineItems,
      idempotencyKey: "editorial-unpublished-parent",
      shippingAddress: { firstName: "Fixture", lastName: "Editor", phone: "+254700000024",
        address1: "Fixture collection contact", country: "KE", city: "Nairobi" } }, String(admin), "paystack"));
    assert.equal(Number((await pool.query("SELECT count(*) FROM uc_orders WHERE user_id=$1", [String(admin)])).rows[0].count), before);
  } finally { parentStatus = "publish"; }
});
test("the saved checkout stores each child identity separately without contacting a payment provider", async () => {
  const { prepareCheckoutOrder, checkoutOrderResponse } = await import("../lib/checkout-orders.js");
  const lines = [0,1].map(index => ({ productId, quantity: 1, variationId: 810100 + index, childSku: seed.variants[index].child_sku }));
  const pending = await prepareCheckoutOrder({ lineItems: lines, fulfillment: "collection", idempotencyKey: "editorial-fixture-checkout",
    shippingAddress: { firstName: "Fixture", lastName: "Editor", phone: "+254700000024", address1: "Fixture collection contact", country: "KE", city: "Nairobi" } }, String(admin), "paystack");
  const response = await checkoutOrderResponse(pending);
  assert.deepEqual(response.lineItems.map((i: any) => [i.variationId,i.childSku]), lines.map(i => [i.variationId,i.childSku]));
  assert.ok(response.lineItems.every((i: any) => i.name.includes(i.childSku)));
  assert.notEqual(response.paymentStatus, "paid");
});
test("legacy ordinary, promoted and repeated variant requests fail before remote fulfillment or order anchors", async () => {
  const countOrders = async () => Number((await pool.query("SELECT count(*) FROM uc_orders WHERE user_id=$1", [String(admin)])).rows[0].count);
  const countItems = async () => Number((await pool.query("SELECT count(*) FROM uc_order_items WHERE order_id IN (SELECT id FROM uc_orders WHERE user_id=$1)", [String(admin)])).rows[0].count);
  const ordersBefore = await countOrders(), itemsBefore = await countItems(), callsBefore = outboundCalls;
  const lineItems = [{ productId, quantity: 1, variationId: 810100, childSku: seed.variants[0].child_sku }];
  const shippingAddress = { firstName: "Fixture", lastName: "Editor", phone: "+254700000024",
    address1: "Fixture collection contact", country: "KE", city: "Nairobi" };
  for (const promoCode of [undefined, "EDITORIAL-LEGACY-PROMO"]) {
    for (const paymentMethod of ["cod", "paystack"]) {
      const body = { lineItems, shippingAddress, paymentMethod, promoCode, idempotencyKey: "editorial-legacy-variant", paymentReference: "" };
      for (let retry = 0; retry < 2; retry++) {
        const response = await request("/uc/orders", "POST", body);
        assert.equal(response.status, 422, JSON.stringify(response.body));
        assert.equal(response.body.code, "VARIANT_CHECKOUT_REFRESH_REQUIRED");
        assert.equal(response.body.retryable, false);
      }
    }
  }
  const { prepareCheckoutOrder } = await import("../lib/checkout-orders.js");
  await assert.rejects(() => prepareCheckoutOrder({ lineItems, shippingAddress, idempotencyKey: "editorial-no-fulfillment" } as any,
    String(admin), "paystack"), /updated variant checkout/);
  assert.equal(outboundCalls, callsBefore, "no Woo pricing/order or payment call on rejected requests");
  assert.equal(await countOrders(), ordersBefore, "no parent-only promotion/retry anchor");
  assert.equal(await countItems(), itemsBefore, "no parent-only saved line");
});

test("gallery gaps and selection-safe media metadata survive a save", async () => {
  const { body: current } = await request(adminPath);
  const first = current.record.images[0];
  const gap = current.record.images.find((i: any) => i.slot === 6);
  current.record.images = current.record.images.map((i: any) => i.slot === 1 ? { ...gap, slot: 1, label: "Product" }
    : i.slot === 6 ? { ...first, slot: 6, label: "Size", alt: "Real size image", pictured_colour: seed.variants[0].label, child_sku: seed.variants[0].child_sku } : i);
  const saved = await request(adminPath, "PUT", current);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const { body: rendered } = await request(`/uc/product-records/${seed.slug}`);
  assert.ok(rendered.images.some((i: any) => i.slot === 6 && i.alt === "Real size image" && i.childSku === seed.variants[0].child_sku));
  assert.equal(rendered.images.filter((i: any) => i.src === first.file).length, 1);
  const { body: after } = await request(adminPath);
  after.record.images = after.record.images.map((i: any) => ({ ...i, approved: false }));
  assert.equal((await request(adminPath, "PUT", after)).status, 200);
  assert.equal((await request(`/uc/product-records/${seed.slug}`)).body.images.length, 0, "removed slots never resurrect live stored photos");
  assert.equal((await request(adminPath)).body.record.images.filter((i: any) => i.approved).length, 0, "migration does not repeat");
});
test("unpublishing and editing known SEO topics updates reciprocal public topic links, not private content", async () => {
  const { body: current } = await request(adminPath);
  const unpublished = structuredClone(current);
  unpublished.record.publishable = false;
  assert.equal((await request(adminPath, "PUT", unpublished)).status, 200);
  const list = (await request("/uc/product-records")).body;
  assert.ok(!list.products.some((p: any) => p.code === seed.code));
  assert.ok(list.topics.every((t: any) => !t.products.some((p: any) => p.code === seed.code)));
  assert.equal((await request(`/uc/product-records/${seed.slug}`)).status, 404);
  const { body: latest } = await request(adminPath);
  latest.record.publishable = true;
  latest.record.seo.topics = latest.record.seo.topics.slice(0,1);
  assert.equal((await request(adminPath, "PUT", latest)).status, 200);
  const republished = (await request("/uc/product-records")).body;
  assert.equal(republished.topics.filter((t: any) => t.products.some((p: any) => p.code === seed.code)).length, 1);
});
