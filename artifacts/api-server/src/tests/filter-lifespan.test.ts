/**
 * Regression tests for catalogue lifespan semantics.
 *
 * The mobile filter tracker treats `lifespanDays > 0` as "trackable filter"
 * and schedules replacement reminders from that value, so the API must never
 * guess a lifespan for unknown products:
 *   - mock products keep their explicit lifespanDays (incl. 0 = not trackable)
 *   - WooCommerce products only get a lifespan from `filter_lifespan_days`
 *     meta; otherwise 0 (previously it defaulted to 365, which would have
 *     scheduled bogus reminders for every live-store product).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct } from "../routes/uc.js";

describe("normalizeProduct lifespan semantics", () => {
  it("keeps an explicit numeric lifespanDays (mock catalogue)", () => {
    const out = normalizeProduct({ id: 1, name: "Hydra Flux", lifespanDays: 90 });
    assert.equal(out["lifespanDays"], 90);
  });

  it("keeps an explicit 0 (non-trackable mock product)", () => {
    const out = normalizeProduct({ id: 21, name: "Bottle Carry Sleeve", lifespanDays: 0 });
    assert.equal(out["lifespanDays"], 0);
  });

  it("defaults to 0 (NOT 365) when lifespan is unknown (Woo product, no meta)", () => {
    const out = normalizeProduct({ id: 501, name: "Live Store Widget", meta_data: [] });
    assert.equal(out["lifespanDays"], 0);
  });

  it("defaults to 0 when there is no meta_data at all", () => {
    const out = normalizeProduct({ id: 502, name: "Live Store Gadget" });
    assert.equal(out["lifespanDays"], 0);
  });

  it("reads filter_lifespan_days from Woo meta_data", () => {
    const out = normalizeProduct({
      id: 503,
      name: "Live Store Filter",
      meta_data: [{ key: "filter_lifespan_days", value: "120" }],
    });
    assert.equal(out["lifespanDays"], 120);
  });

  it("ignores non-positive meta values", () => {
    const out = normalizeProduct({
      id: 504,
      name: "Bad Meta Product",
      meta_data: [{ key: "filter_lifespan_days", value: "0" }],
    });
    assert.equal(out["lifespanDays"], 0);
  });
});
