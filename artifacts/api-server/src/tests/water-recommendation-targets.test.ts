import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withWaterRecommendationTarget, WATER_RECOMMENDATION_TARGETS } from "../lib/water-recommendation-targets.js";

describe("verified assessment recommendation catalogue targets", () => {
  it("returns only exact verified SKU/name catalogue IDs", async () => {
    for (const [name, target] of Object.entries(WATER_RECOMMENDATION_TARGETS)) {
      const result = await withWaterRecommendationTarget({ name, why: "Family-fit guidance" }, async sku => {
        assert.equal(sku, target.sku);
        return [{ id: 987, name: target.name, sku }];
      });
      assert.equal(result.productId, 987);
      assert.equal(result.productName, target.name);
      assert.equal(result.action, "product");
    }
  });
  it("does not guess for missing, retired, differently named or unavailable products", async () => {
    for (const products of [null, [], [{ id: 987, sku: "different", name: "Sweet Home" }], [{ id: 987, sku: "UC-FCT-SWH-011", name: "Sweet Home replacement" }], [{ id: 0, sku: "UC-FCT-SWH-011", name: "Sweet Home" }]]) {
      const result = await withWaterRecommendationTarget({ name: "Sweet Home faucet filtration", why: "Guidance" }, async () => products);
      assert.equal(result.action, "enquiry");
      assert.equal(result.productId, undefined);
    }
  });
  it("partnership recommendations never open a guessed catalogue product", async () => {
    for (const name of ["Refill / bulk water supply", "Institutional systems", "Distribution partnership", "Unrecognised legacy recommendation"]) {
      const result = await withWaterRecommendationTarget({ name, why: "Guidance" }, async () => { throw new Error("Must not query catalogue"); });
      assert.equal(result.action, "enquiry");
    }
  });
});