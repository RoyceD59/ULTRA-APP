import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categoryNameMatches, normalizeStoreCategory, fetchAllPublishedProducts, wcFetchAllPages } from "../routes/uc.js";

describe("app catalogue category and complete-pagination contracts", () => {
  it("normalizes visible category labels and retains segment aliases", () => {
    assert.equal(normalizeStoreCategory(" Home & Kitchen "), "home and kitchen");
    assert.ok(categoryNameMatches("Home Filters", "Home"));
    assert.ok(categoryNameMatches("Bottle Filters", "Bottles"));
    assert.ok(!categoryNameMatches("Industrial", "Bottles"));
  });
  it("never returns a truncated list at the safety bound or after a failed page", async () => {
    let calls = 0;
    assert.equal(await fetchAllPublishedProducts(async () => {
      calls++; return Array.from({ length: 100 }, (_, id) => ({ id }));
    }), null);
    assert.equal(calls, 50);
    assert.equal(await fetchAllPublishedProducts(async page =>
      page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : null), null);
  });
  it("keeps late-page products through the complete-page adapter", async () => {
    const products = await fetchAllPublishedProducts(async page =>
      page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 501 }]);
    assert.equal(products?.length, 101);
    assert.equal(products?.at(-1)?.id, 501);
  });
  it("category compatibility reads never contact a retired Woo provider", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("No retired network"); };
    try {
      assert.ok(Array.isArray(await wcFetchAllPages("/products/categories")));
      assert.equal(calls, 0);
    } finally { globalThis.fetch = realFetch; }
  });
});
