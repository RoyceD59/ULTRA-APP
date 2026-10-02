import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { testResourceLimits } from "./resource-limits.js";

describe("API test resource limits", () => {
  it("bounds test workers and Go transform threads by default", () => {
    assert.deepEqual(testResourceLimits({}), { concurrency: 4, goMaxProcs: "2" });
  });
  it("preserves explicit, valid operator settings", () => {
    assert.deepEqual(testResourceLimits({ TEST_CONCURRENCY: "8", GOMAXPROCS: "1" }),
      { concurrency: 8, goMaxProcs: "1" });
  });
  it("rejects invalid worker limits before creating a database", () => {
    for (const value of ["", "0", "-1", "1.5", "17", "NaN"]) {
      assert.throws(() => testResourceLimits({ TEST_CONCURRENCY: value }), /TEST_CONCURRENCY/);
    }
  });
});