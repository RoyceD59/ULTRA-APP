/**
 * Tests for the product lifespan audit — flags live purchasable filter
 * products that lack a filter_lifespan_days meta (lifespanDays === 0) so the
 * team is warned before customers silently miss replacement reminders.
 *
 * False-alarm exemptions:
 *   - enquiry-only products
 *   - products with no purchasable price
 *   - products only in accessory categories
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  auditProductLifespans,
  fetchAllPublishedProducts,
  normalizeProduct,
  warnForMissingProductLifespans,
} from "../routes/uc.js";

const filterCat = { id: 2, name: "Home Filters" };
const accessCat = { id: 4, name: "Accessories" };

describe("auditProductLifespans", () => {
  it("flags a purchasable filter product with lifespanDays 0", () => {
    const missing = auditProductLifespans([
      { id: 501, name: "New Widget", price: "2999", lifespanDays: 0, categories: [filterCat] },
    ]);
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!["id"], 501);
  });

  it("does not flag a product with a positive lifespan", () => {
    const missing = auditProductLifespans([
      { id: 1, name: "Hydra Flux", price: "3499", lifespanDays: 90, categories: [filterCat] },
    ]);
    assert.equal(missing.length, 0);
  });

  it("does not flag enquiry-only products", () => {
    const missing = auditProductLifespans([
      { id: 21, name: "Carry Sleeve", price: "0", lifespanDays: 0, enquiryOnly: true, categories: [accessCat] },
    ]);
    assert.equal(missing.length, 0);
  });

  it("does not flag zero-priced products (enquiry-only in practice)", () => {
    const missing = auditProductLifespans([
      { id: 30, name: "Water ATMs", price: "0", lifespanDays: 0, categories: [{ id: 5, name: "Solutions" }] },
    ]);
    assert.equal(missing.length, 0);
  });

  it("does not flag accessory-only products even when priced", () => {
    const missing = auditProductLifespans([
      { id: 40, name: "Bottle Stand", price: "999", lifespanDays: 0, categories: [accessCat] },
    ]);
    assert.equal(missing.length, 0);
  });

  it("flags a priced product listed in both accessory and filter categories", () => {
    const missing = auditProductLifespans([
      { id: 41, name: "Combo Filter", price: "1999", lifespanDays: 0, categories: [accessCat, filterCat] },
    ]);
    assert.equal(missing.length, 1);
  });

  it("flags a priced product with no categories at all", () => {
    const missing = auditProductLifespans([
      { id: 42, name: "Uncategorised", price: "1500", lifespanDays: 0, categories: [] },
    ]);
    assert.equal(missing.length, 1);
  });

  it("works end-to-end on a normalized WooCommerce product without meta", () => {
    const norm = normalizeProduct({
      id: 600,
      name: "Live Store Filter",
      price: "4500",
      categories: [filterCat],
      meta_data: [],
    });
    assert.equal(auditProductLifespans([norm]).length, 1);
  });

  it("works end-to-end on a normalized WooCommerce product with meta", () => {
    const norm = normalizeProduct({
      id: 601,
      name: "Live Store Filter",
      price: "4500",
      categories: [filterCat],
      meta_data: [{ key: "filter_lifespan_days", value: "120" }],
    });
    assert.equal(auditProductLifespans([norm]).length, 0);
  });
});

describe("warnForMissingProductLifespans", () => {
  it("warns with the ID and name of an emitted trackable product missing its lifespan", () => {
    const warnings: Array<{ details: { productId: number; productName: string }; message: string }> = [];

    warnForMissingProductLifespans(
      [{ id: 501, name: "New Widget", price: "2999", lifespanDays: 0, categories: [filterCat] }],
      (details, message) => warnings.push({ details, message }),
    );

    assert.deepEqual(warnings, [{
      details: { productId: 501, productName: "New Widget" },
      message: "Product catalogue is emitting a trackable product without filter_lifespan_days",
    }]);
  });

  it("does not warn for trackable products with a lifespan or legitimate non-trackable products", () => {
    const warnings: unknown[] = [];

    warnForMissingProductLifespans(
      [
        { id: 1, name: "Hydra Flux", price: "3499", lifespanDays: 90, categories: [filterCat] },
        { id: 40, name: "Bottle Stand", price: "999", lifespanDays: 0, categories: [accessCat] },
        { id: 30, name: "Water ATMs", price: "0", lifespanDays: 0, categories: [{ name: "Solutions" }] },
      ],
      (...args) => warnings.push(args),
    );

    assert.equal(warnings.length, 0);
  });
});

describe("fetchAllPublishedProducts pagination", () => {
  const makeProduct = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    name: `Product ${id}`,
    price: "1000",
    categories: [filterCat],
    meta_data: [{ key: "filter_lifespan_days", value: "90" }],
    ...extra,
  });

  it("follows pagination and includes a missing-meta product on a later page", async () => {
    // Page 1: 100 fully-tagged products. Page 2: 5 products, one missing meta.
    const page1 = Array.from({ length: 100 }, (_, i) => makeProduct(i + 1));
    const page2 = [
      makeProduct(101),
      makeProduct(102),
      makeProduct(103, { meta_data: [] }), // ← missing lifespan meta
      makeProduct(104),
      makeProduct(105),
    ];
    const pages: Record<number, Record<string, unknown>[]> = { 1: page1, 2: page2 };
    const requested: number[] = [];

    const all = await fetchAllPublishedProducts(async (page) => {
      requested.push(page);
      return pages[page] ?? [];
    });

    assert.notEqual(all, null);
    assert.deepEqual(requested, [1, 2]); // stopped after the short page
    assert.equal(all!.length, 105); // checkedCount covers every page

    const missing = auditProductLifespans(all!.map(normalizeProduct));
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!["id"], 103);
  });

  it("stops after a single short page", async () => {
    const requested: number[] = [];
    const all = await fetchAllPublishedProducts(async (page) => {
      requested.push(page);
      return [makeProduct(1), makeProduct(2)];
    });
    assert.deepEqual(requested, [1]);
    assert.equal(all!.length, 2);
  });

  it("returns null when any page fails — no partial-catalogue false all-clear", async () => {
    const all = await fetchAllPublishedProducts(async (page) =>
      page === 2 ? null : Array.from({ length: 100 }, (_, i) => makeProduct(i + 1)),
    );
    assert.equal(all, null);
  });

  it("returns null when the page cap is hit with every page full (possibly partial catalogue)", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => makeProduct(i + 1));
    let calls = 0;
    const all = await fetchAllPublishedProducts(async () => {
      calls++;
      return fullPage; // every page full — catalogue may extend past the cap
    });
    assert.equal(all, null); // no partial success
    assert.equal(calls, 50); // stopped at the safety cap
  });
});
