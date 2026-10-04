import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import router from "../routes/uc.js";

test("anonymous catalogue requests only published WooCommerce products on every page", async () => {
  // Worker-local fake provider configuration; no real WooCommerce network calls.
  process.env["WC_CONSUMER_KEY"] = "fixture-key";
  process.env["WC_CONSUMER_SECRET"] = "fixture-secret";
  process.env["WC_BASE_URL"] = "https://catalogue.fixture";
  const realFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "catalogue.fixture");
    calls.push(url);
    assert.equal(url.searchParams.get("status"), "publish");
    const page = Number(url.searchParams.get("page"));
    const products = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `Published ${index + 1}`, status: "publish", price: "100", images: [] }))
      : [{ id: 101, name: "Published 101", status: "publish", price: "100", images: [] }];
    return new Response(JSON.stringify(products), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const app = express();
  app.use("/api", router);
  const server = http.createServer(app);
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const response = await realFetch(`http://127.0.0.1:${address.port}/api/uc/products?publicationSafe=true`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-UC-Catalogue-Provenance"), "woocommerce-published");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const products = await response.json() as Array<{ id: number }>;
    assert.equal(products.length, 101);
    assert.equal(products.at(-1)?.id, 101);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => url.searchParams.get("status") === "publish"));
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];
    const unavailable = await realFetch(`http://127.0.0.1:${address.port}/api/uc/products?publicationSafe=true`);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("Cache-Control"), "no-store");
    assert.equal(unavailable.headers.get("X-UC-Catalogue-Provenance"), null);
    assert.match((await unavailable.json() as { error: string }).error, /not configured/);
    assert.equal(calls.length, 2, "unconfigured safe mode must not call WooCommerce");
    const ordinary = await realFetch(`http://127.0.0.1:${address.port}/api/uc/products`);
    assert.equal(ordinary.status, 200, "ordinary app demo fallback must remain available");
    assert.equal(ordinary.headers.get("X-UC-Catalogue-Provenance"), null);
    assert.ok(Array.isArray(await ordinary.json()));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];
    delete process.env["WC_BASE_URL"];
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});