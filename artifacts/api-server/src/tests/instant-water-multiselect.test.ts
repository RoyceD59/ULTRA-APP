import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeWaterSelections, scoreInstantWaterCheck, WATER_SOURCES, WATER_CONCERNS, WATER_SETTINGS } from "../lib/instant-water-check.js";
import { CreatePublicInstantWaterAssessmentBody } from "@workspace/api-zod";

describe("bounded multi-answer water assessment", () => {
  const base = { area: "Kajiado", sources: ["municipal"] as const, concerns: ["taste"] as const, settings: ["home"] as const };
  const normal = () => ({ area: base.area, sources: [...base.sources], concerns: [...base.concerns], settings: [...base.settings] });
  it("normalises old scalars and accepts three distinct options in every question", () => {
    const old = normalizeWaterSelections({ source: "municipal", concern: "taste", setting: "home", area: "Nairobi" });
    assert.deepEqual(old.sources, ["municipal"]);
    for (const [key, choices] of [["sources", WATER_SOURCES], ["concerns", WATER_CONCERNS], ["settings", WATER_SETTINGS]] as const) {
      const result = normalizeWaterSelections({ ...normal(), [key]: [...choices.slice(0, 3)] });
      assert.equal(result[key]?.length, 3);
    }
  });
  it("rejects empty, fourth, duplicate, unknown and inconsistent mixed answers for each question", () => {
    for (const [key, scalar, choices] of [["sources", "source", WATER_SOURCES], ["concerns", "concern", WATER_CONCERNS], ["settings", "setting", WATER_SETTINGS]] as const) {
      for (const bad of [[], [...choices.slice(0, 4)], [choices[0], choices[0]], ["unknown"]]) {
        assert.throws(() => normalizeWaterSelections({ ...normal(), [key]: bad } as never), /INVALID_SELECTIONS/);
      }
      assert.throws(() => normalizeWaterSelections({ ...normal(), [key]: [choices[0]], [scalar]: choices[1] } as never));
    }
  });
  it("includes all sources and concerns, keeps regional flags and is tap-order independent", () => {
    const input = normalizeWaterSelections({ area: "Kajiado", sources: ["bottled", "borehole", "shallow"], concerns: ["taste", "skin", "safety"], settings: ["home", "school", "salon"] });
    const result = scoreInstantWaterCheck(input, "KE");
    const reversed = scoreInstantWaterCheck(normalizeWaterSelections({ ...input, sources: [...input.sources!].reverse(), concerns: [...input.concerns!].reverse(), settings: [...input.settings!].reverse() }), "KE");
    assert.deepEqual(result, reversed);
    assert.deepEqual(result.levels, { hardness: 3, taste: 3, sediment: 3, microbial: 3 });
    assert.deepEqual(result.areaFlags, { hardGroundwater: true, riftValleyFluoride: true });
    assert.equal(result.recommendation.name, "Shower & skin filtration");
  });
  it("counts overlapping concern/symptom only once and uses explicit setting precedence", () => {
    const input = normalizeWaterSelections({ area: "Unknown", sources: ["bottled"], concerns: ["scale"], settings: ["home", "resell"], symptom: "scale" });
    const scored = scoreInstantWaterCheck(input, "France");
    assert.equal(scored.levels.hardness, 2);
    assert.equal(scored.recommendation.name, "Distribution partnership");
  });
  it("generated contracts retain arrays while rejecting oversized arrays", () => {
    const body = { firstName: "Amara", phone: "+254712345678", consent: true, idempotencyKey: "multi-test-contract", answers: { country: "KE", ...normal() } };
    const parsed = CreatePublicInstantWaterAssessmentBody.safeParse(body);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.deepEqual(parsed.data.answers.sources, ["municipal"]);
    assert.equal(CreatePublicInstantWaterAssessmentBody.safeParse({ ...body, answers: { ...body.answers, settings: WATER_SETTINGS.slice(0, 4) } }).success, false);
  });
});