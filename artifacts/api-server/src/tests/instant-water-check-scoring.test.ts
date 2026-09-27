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
    }, "Kenya");
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
    assert.equal(result.provenance, "reviewed_regional_guidance");
  });

  it("caps adjustments at High and raises hard groundwater only for the approved sources", () => {
    const result = scoreInstantWaterCheck({
      source: "borehole",
      concern: "scale",
      area: "Kitengela",
      setting: "home",
    }, "Kenya");
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
    }, "Kenya");
    const municipal = scoreInstantWaterCheck({
      source: "municipal",
      concern: "safety",
      area: "Nakuru",
      setting: "home",
    }, "Kenya");
    assert.equal(borehole.areaFlags.riftValleyFluoride, true);
    assert.equal(municipal.areaFlags.riftValleyFluoride, false);
  });

  it("rejects uncontrolled answer values", () => {
    assert.throws(() => scoreInstantWaterCheck({
      source: "unknown" as never,
      concern: "cost",
      area: "Nairobi",
      setting: "home",
    }, "Kenya"), /Invalid water source/);
  });

  it("applies reviewed broad source guidance across the six approved countries", () => {
    for (const country of ["Ghana", "Kenya", "Tanzania", "Rwanda", "Nigeria", "Uganda"]) {
      const result = scoreInstantWaterCheck({
        source: "borehole",
        concern: "cost",
        area: "Springfield",
        setting: "home",
      }, country);
      assert.equal(result.provenance, "reviewed_regional_guidance");
      assert.equal(result.levels.hardness, 3);
      assert.match(result.disclaimer, /reviewed.*country-level source guidance/i);
    }
  });

  it("keeps unknown countries general and scopes Kenya area flags to Kenya", () => {
    const kenya = scoreInstantWaterCheck({
      source: "borehole",
      concern: "cost",
      area: "Nakuru",
      setting: "home",
    }, "Kenya");
    const tanzania = scoreInstantWaterCheck({
      source: "borehole",
      concern: "cost",
      area: "Nakuru",
      setting: "home",
    }, "Tanzania");
    const unknown = scoreInstantWaterCheck({
      source: "borehole",
      concern: "cost",
      area: "Nakuru",
      setting: "home",
    }, "Zambia");
    assert.equal(kenya.areaFlags.riftValleyFluoride, true);
    assert.equal(tanzania.areaFlags.riftValleyFluoride, false);
    assert.equal(tanzania.areaFlags.hardGroundwater, false);
    assert.equal(unknown.provenance, "general_indicative");
    assert.match(unknown.disclaimer, /general source-type rules/i);
  });
});