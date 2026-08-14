/**
 * Regression tests for the reminder-gap classification used by
 * GET /api/uc/admin/orders/reminder-gaps.
 *
 * An order line item produces a "reminder gap" when the purchased product
 * will never generate a replacement reminder:
 *   - "missing-lifespan": product is in the catalogue and needs a lifespan
 *     (per auditProductLifespans) but has none set
 *   - "unknown-product": product id is not in the catalogue at all
 *   - null: product is trackable, or legitimately exempt (enquiry-only /
 *     accessory-only) — no gap
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyReminderGap, auditProductLifespans, normalizeProduct } from "../routes/uc.js";

function buildSets(products: Record<string, unknown>[]) {
  const normalized = products.map(normalizeProduct);
  return {
    catalogueIds: new Set(normalized.map((p) => Number(p["id"]))),
    flaggedIds: new Set(auditProductLifespans(normalized).map((p) => Number(p["id"]))),
  };
}

describe("classifyReminderGap", () => {
  const catalogue = [
    // Trackable filter — has a lifespan, no gap
    { id: 1, name: "Hydra Flux", price: "4500", lifespanDays: 90 },
    // Purchasable filter with NO lifespan — the gap this report exists for
    { id: 2, name: "New Store Filter", price: "3000", meta_data: [] },
    // Enquiry-only product — exempt, no reminder expected
    { id: 3, name: "Whole House System", price: "0", enquiryOnly: true },
    // Accessory-only categories — exempt
    {
      id: 4, name: "Bottle Sleeve", price: "800",
      categories: [{ name: "Accessories" }],
    },
  ];
  const { catalogueIds, flaggedIds } = buildSets(catalogue);

  it("returns null for a trackable product with a lifespan", () => {
    assert.equal(classifyReminderGap(1, catalogueIds, flaggedIds), null);
  });

  it("flags a purchasable product missing its lifespan", () => {
    assert.equal(classifyReminderGap(2, catalogueIds, flaggedIds), "missing-lifespan");
  });

  it("does not flag enquiry-only products", () => {
    assert.equal(classifyReminderGap(3, catalogueIds, flaggedIds), null);
  });

  it("does not flag accessory-only products", () => {
    assert.equal(classifyReminderGap(4, catalogueIds, flaggedIds), null);
  });

  it("flags a product id that is not in the catalogue at all", () => {
    assert.equal(classifyReminderGap(999, catalogueIds, flaggedIds), "unknown-product");
  });
});
