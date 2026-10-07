import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type http from "node:http";
import { invalidateCatalogueCache } from "../routes/uc.js";

let server: http.Server;
let base: string;
const realFetch = globalThis.fetch;

before(async () => {
  // Test process only: no live providers or credentials are used.
  process.env["WC_CONSUMER_KEY"] = "fixture-key";
  process.env["WC_CONSUMER_SECRET"] = "fixture-secret";
  process.env["WC_BASE_URL"] = "https://public-products.test";
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(async () => {
  globalThis.fetch = realFetch;
  delete process.env["WC_CONSUMER_KEY"];
  delete process.env["WC_CONSUMER_SECRET"];
  delete process.env["WC_BASE_URL"];
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("product details distinguish published WooCommerce, unpublished and demo fallback", async () => {
  for (const [status, expected] of [["publish", "woocommerce-published"], ["draft", "unverified"], ["private", "unverified"]]) {
    globalThis.fetch = (async () => Response.json({ id: 123, name: "Public filter", status, price: "1200" })) as typeof fetch;
    const response = await realFetch(`${base}/uc/products/123`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-uc-product-source"), expected);
    assert.equal((await response.json()).name, "Public filter");
  }
  globalThis.fetch = (async () => { throw new Error("upstream unavailable"); }) as typeof fetch;
  const fallback = await realFetch(`${base}/uc/products/1`);
  assert.equal(fallback.status, 200, "existing app fallback remains available");
  assert.equal(fallback.headers.get("x-uc-product-source"), "unverified");
});

test("catalogue requests published products and refuses to attest a mixed private list", async () => {
  for (const [status, expected] of [["publish", "woocommerce-published"], ["private", "unverified"]]) {
    // Each fixture is a new upstream snapshot; bypass the previous scenario's
    // valid browsing TTL without changing production cache semantics.
    invalidateCatalogueCache();
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("status"), "publish");
      return Response.json([{ id: 123, name: "Filter", status }]);
    }) as typeof fetch;
    const response = await realFetch(`${base}/uc/products`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-uc-product-source"), expected);
    const publicResponse = await realFetch(`${base}/uc/products?publicationSafe=true`);
    assert.equal(publicResponse.status, status === "publish" ? 200 : 503);
    assert.equal(publicResponse.headers.get("x-uc-catalogue-provenance"),
      status === "publish" ? "woocommerce-published" : null);
  }
});

test("publication-safe detail reads live operations only and never fall back to mock stock", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ id: 123, name: "PRIVATE provider wording", status: "publish",
      sku: "UC-BOG-SSB-008", description: "PRIVATE description", price: "4199", stock_status: "outofstock",
      images: [{ src: "https://media.example/product.jpg", alt: "Bottle" }] });
  }) as typeof fetch;
  for (let i = 0; i < 2; i++) {
    const response = await realFetch(`${base}/uc/products/123?publicationSafe=true`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-uc-catalogue-provenance"), "woocommerce-live");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.stockStatus, "outofstock");
    assert.equal(body.name, undefined);
    assert.equal(body.description, undefined);
    assert.ok(Array.isArray(body.uploadedPhotos));
  }
  assert.equal(calls, 2, "stock reads must bypass browsing snapshots");
  globalThis.fetch = (async () => Response.json({ id: 123, status: "draft" })) as typeof fetch;
  assert.equal((await realFetch(`${base}/uc/products/123?publicationSafe=true`)).status, 404);
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.equal((await realFetch(`${base}/uc/products/1?publicationSafe=true`)).status, 503);
  delete process.env["WC_CONSUMER_KEY"];
  assert.equal((await realFetch(`${base}/uc/products/1?publicationSafe=true`)).status, 503);
  process.env["WC_CONSUMER_KEY"] = "fixture-key";
});