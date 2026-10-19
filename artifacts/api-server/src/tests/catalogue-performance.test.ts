import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import app from "../app.js";
import { invalidateCatalogueCache } from "../routes/uc.js";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

test("repeated complete app-catalogue reads never consult retired Woo credentials", async () => {
  const product = await appCatalogueFixture();
  const realFetch = globalThis.fetch;
  const saved = { ...process.env };
  process.env.WC_BASE_URL = "https://retired-catalogue.invalid";
  process.env.WC_CONSUMER_KEY = "fixture";
  process.env.WC_CONSUMER_SECRET = "fixture";
  let remoteCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("retired-catalogue.invalid")) {
      remoteCalls++;
      throw new Error("Retired provider must not be contacted");
    }
    return realFetch(input, init);
  };
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    invalidateCatalogueCache();
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/products`;
    for (let i = 0; i < 10; i++) {
      const response = await realFetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const rows = await response.json() as { id: number; price: string }[];
      assert.equal(rows.filter(row => row.id === product.id).length, 1);
      assert.equal(Number(rows.find(row => row.id === product.id)!.price), product.price);
    }
    assert.equal(remoteCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of ["WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET"]) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
