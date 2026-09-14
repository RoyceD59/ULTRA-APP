import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreInstantWaterCheck,
  INSTANT_WATER_CHECK_RULES_VERSION,
} from "../lib/instant-water-check.js";

describe("instant-water-check-v1 scorer", () => {
  it("copies the prototype baseline and concern bump on the server", () => {
    const result = scoreInstantWaterCheck({
      source: "municipal",
      concern: "taste",
      area: "Nairobi – Westlands",
      setting: "home",
    });
    assert.equal(result.rulesVersion, INSTANT_WATER_CHECK_RULES_VERSION);
    assert.deepEqual(result.levels, {
      hardness: 2,
      taste: 3,
      sediment: 2,
      microbial: 1,
    });
    assert.deepEqual(result.bands, {
      hardness: "Moderate",
      taste: "High",
      sediment: "Moderate",
      microbial: "Low",
    });
    assert.match(result.disclaimer, /not a laboratory analysis/i);
  });

  it("caps adjustments at High and raises hard groundwater only for the approved sources", () => {
    const result = scoreInstantWaterCheck({
      source: "borehole",
      concern: "scale",
      area: "Kitengela",
      setting: "home",
    });
    assert.equal(result.levels.hardness, 3);
    assert.equal(result.bands.hardness, "High");
    assert.equal(result.areaFlags.hardGroundwater, true);
    assert.equal(result.areaFlags.riftValleyFluoride, false);
  });

  it("flags the Rift Valley fluoride region only for borehole water", () => {
    const borehole = scoreInstantWaterCheck({
      source: "borehole",
      concern: "safety",
      area: "Nakuru",
      setting: "home",
    });
    const municipal = scoreInstantWaterCheck({
      source: "municipal",
      concern: "safety",
      area: "Nakuru",
      setting: "home",
    });
    assert.equal(borehole.areaFlags.riftValleyFluoride, true);
    assert.equal(municipal.areaFlags.riftValleyFluoride, false);
  });

  it("rejects uncontrolled answer values", () => {
    assert.throws(() => scoreInstantWaterCheck({
      source: "unknown" as never,
      concern: "cost",
      area: "Nairobi",
      setting: "home",
    }), /Invalid water source/);
  });
});