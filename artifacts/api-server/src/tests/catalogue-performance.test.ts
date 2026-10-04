import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import http from "node:http";
import router, { invalidateCatalogueCache } from "../routes/uc.js";

test("catalogue warm responses avoid provider reads, preserve all pages and fail explicitly", async () => {
  process.env["WC_CONSUMER_KEY"] = "fixture-key";
  process.env["WC_CONSUMER_SECRET"] = "fixture-secret";
  process.env["WC_BASE_URL"] = "https://catalogue.fixture";
  const realFetch = globalThis.fetch;
  let reads = 0;
  let failure = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "catalogue.fixture");
    reads++;
    if (failure) return new Response("[]", { status: 503 });
    await new Promise(resolve => setTimeout(resolve, 40));
    const count = url.searchParams.get("page") === "1" ? 100 : 1;
    return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => ({
      id: count === 1 ? 101 : i + 1, status: "publish", name: "Filter", price: "100", images: [],
      meta_data: [{ key: "filter_lifespan_days", value: 180 }],
    }))));
  }) as typeof fetch;
  const app = express();
  app.use("/api", router);
  const server = http.createServer(app);
  invalidateCatalogueCache();
  try {
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/products`;
    const start = performance.now();
    const cold = await realFetch(base);
    assert.equal((await cold.json() as unknown[]).length, 101);
    const coldMs = performance.now() - start;
    const warmTimings = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      const warm = await realFetch(base);
      assert.equal(warm.headers.get("X-UC-Catalogue-Cache"), "hit");
      assert.equal(warm.headers.get("Cache-Control"), "no-store");
      assert.equal((await warm.json() as unknown[]).length, 101);
      warmTimings.push(performance.now() - t);
    }
    assert.equal(reads, 2, "10 catalogue requests use 2 page reads instead of 20");
    // Measure rather than timing-assert against variable CI/container CPU.
    console.info(JSON.stringify({ scenario: "10 identical complete 101-product reads",
      coldMs, warmMedianMs: warmTimings.sort((a, b) => a - b)[4],
      upstreamReads: reads, withoutCacheReads: 20, upstreamReductionPercent: 90 }));
    invalidateCatalogueCache();
    failure = true;
    const failed = await realFetch(base);
    assert.equal(failed.status, 502, "non-2xx empty upstream must not become successful empty catalogue");
    assert.match((await failed.json() as { error: string }).error, /unavailable/);
    failure = false;
    const recovered = await realFetch(base);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get("X-UC-Catalogue-Cache"), "miss");
  } finally {
    invalidateCatalogueCache();
    globalThis.fetch = realFetch;
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];
    delete process.env["WC_BASE_URL"];
    await new Promise<void>(r => server.close(() => r()));
  }
});