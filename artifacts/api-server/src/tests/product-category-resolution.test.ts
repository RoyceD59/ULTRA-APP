import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categoryNameMatches, normalizeStoreCategory, wcFetchAllPages } from "../routes/uc.js";

describe("store category label resolution", () => {
  it("fails explicitly at the complete-pagination safety bound or on a later page failure", async () => {
    const originalFetch = globalThis.fetch;
    const savedBase = process.env["WC_BASE_URL"];
    try {
      process.env["WC_BASE_URL"] = "https://bounded-pages.test";
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return new Response(JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ id }))));
      }) as typeof fetch;
      assert.equal(await wcFetchAllPages("/products"), null);
      assert.equal(calls, 50, "never return the truncated 5,000-row list");
      calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return calls === 1
          ? new Response(JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ id }))))
          : new Response("[]", { status: 503 });
      }) as typeof fetch;
      assert.equal(await wcFetchAllPages("/products"), null);
      assert.equal(calls, 2, "do not cache or expose a partial first page");
    } finally {
      globalThis.fetch = originalFetch;
      if (savedBase === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = savedBase;
    }
  });
  const visibleCategories = [
    "Bottles & Portable",
    "Home Filters",
    "Shower & Skin",
    "Accessories",
    "Solutions",
  ];

  it("normalizes every visible category label", () => {
    for (const category of visibleCategories) {
      assert.notEqual(normalizeStoreCategory(category), "");
    }
  });

  it("matches every visible segment to WooCommerce-friendly aliases", () => {
    const examples: Array<[string, string]> = [
      ["Bottles & Portable", "Portable Filters"],
      ["Home Filters", "Household Filters"],
      ["Shower & Skin", "Shower Filters"],
      ["Accessories", "Accessories"],
      ["Solutions", "Water Treatment Solutions"],
    ];
    for (const [visible, live] of examples) {
      assert.equal(categoryNameMatches(visible, live), true, `${visible} should match ${live}`);
    }
  });

  it("does not mistake unrelated categories for a selected segment", () => {
    assert.equal(categoryNameMatches("Home Filters", "Accessories"), false);
    assert.equal(categoryNameMatches("Solutions", "Shower Filters"), false);
  });

  it("collects every WooCommerce page before a normalized fallback filters it", async () => {
    const saved = {
      key: process.env["WC_CONSUMER_KEY"],
      secret: process.env["WC_CONSUMER_SECRET"],
      base: process.env["WC_BASE_URL"],
    };
    const originalFetch = globalThis.fetch;
    try {
      process.env["WC_CONSUMER_KEY"] = "test-key";
      process.env["WC_CONSUMER_SECRET"] = "test-secret";
      process.env["WC_BASE_URL"] = "https://category-pages.test";
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        const page = Number(url.searchParams.get("page"));
        const body = page === 1
          ? Array.from({ length: 100 }, (_, id) => ({ id, categories: [{ name: "Accessories" }] }))
          : page === 2
            ? [{ id: 101, categories: [{ name: "Home Filters" }] }]
            : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;

      const products = await wcFetchAllPages("/products");
      assert.equal(products?.length, 101);
      assert.equal(
        products?.filter(product =>
          (product.categories as { name: string }[]).some(category =>
            categoryNameMatches("Home Filters", category.name),
          ),
        ).length,
        1,
        "a matching product on page two must survive the fallback",
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (saved.key === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = saved.key;
      if (saved.secret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = saved.secret;
      if (saved.base === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = saved.base;
    }
  });

  it("uses the same complete paging strategy for category lookup", async () => {
    const savedBase = process.env["WC_BASE_URL"];
    const originalFetch = globalThis.fetch;
    try {
      process.env["WC_BASE_URL"] = "https://category-lookup-pages.test";
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        const body = page === 1
          ? Array.from({ length: 100 }, (_, id) => ({ id, name: `Other ${id}` }))
          : page === 2
            ? [{ id: 501, name: "Home Filters" }]
            : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;

      const categories = await wcFetchAllPages("/products/categories", { hide_empty: "false" });
      assert.equal(categories?.find(category => category.name === "Home Filters")?.id, 501);
    } finally {
      globalThis.fetch = originalFetch;
      if (savedBase === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = savedBase;
    }
  });
});