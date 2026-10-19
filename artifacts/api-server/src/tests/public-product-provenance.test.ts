import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type http from "node:http";
import { pool } from "@workspace/db";
import { invalidateCatalogueCache } from "../routes/uc.js";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

let server: http.Server, base: string;
let product: Awaited<ReturnType<typeof appCatalogueFixture>>;
const realFetch = globalThis.fetch;
const saved = { ...process.env };
let remoteCalls = 0;
before(async () => {
  product = await appCatalogueFixture();
  process.env.WC_BASE_URL = "https://retired-products.invalid";
  process.env.WC_CONSUMER_KEY = "fixture";
  process.env.WC_CONSUMER_SECRET = "fixture";
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("retired-products.invalid")) {
      remoteCalls++;
      throw new Error("Retired provider must not supply publication evidence");
    }
    return realFetch(input, init);
  };
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/products`;
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const key of ["WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET"]) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test("anonymous publication-safe catalogue attests app-owned records with or without Woo credentials", async () => {
  for (const configured of [true, false]) {
    if (!configured) {
      delete process.env.WC_CONSUMER_KEY;
      delete process.env.WC_CONSUMER_SECRET;
    }
    invalidateCatalogueCache();
    const response = await realFetch(`${base}?publicationSafe=true`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-uc-catalogue-provenance"), "companion-published");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok((await response.json() as { id: number }[]).some(row => row.id === product.id));
  }
  assert.equal(remoteCalls, 0);
});

test("publication-safe detail uses fresh local inventory, not remote stock or wording", async () => {
  for (const stock of ["instock", "outofstock"]) {
    await pool.query("UPDATE uc_catalogue_inventory SET stock_status=$1 WHERE id=$2", [stock, product.id]);
    const response = await realFetch(`${base}/${product.id}?publicationSafe=true`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-uc-catalogue-provenance"), "companion-published");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.stockStatus, stock);
    assert.equal(body.name, undefined);
    assert.equal(body.description, undefined);
    assert.ok(Array.isArray(body.uploadedPhotos));
  }
  assert.equal(remoteCalls, 0);
});

test("unknown local products do not fall back to demo or Woo publication evidence", async () => {
  assert.equal((await realFetch(`${base}/2147483647`)).status, 404);
  const safe = await realFetch(`${base}/2147483647?publicationSafe=true`);
  assert.ok([404, 503].includes(safe.status));
  assert.equal(safe.headers.get("x-uc-catalogue-provenance"), null);
  assert.equal(remoteCalls, 0);
});
