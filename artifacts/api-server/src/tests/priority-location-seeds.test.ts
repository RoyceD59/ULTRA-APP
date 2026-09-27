import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PRIORITY_LOCATION_SEEDS } from "../lib/priority-locations.js";

const PRIORITY_COUNTRIES = ["GH", "KE", "NG", "RW", "TZ", "UG"];

describe("priority location starter directory", () => {
  test("contains a complete, reviewable record for every priority country", () => {
    assert.deepEqual(
      [...new Set(PRIORITY_LOCATION_SEEDS.map((location) => location.countryIso))].sort(),
      PRIORITY_COUNTRIES,
    );

    for (const location of PRIORITY_LOCATION_SEEDS) {
      assert.equal(location.type, "city_tap");
      assert.ok(location.name);
      assert.ok(location.address);
      assert.ok(location.city);
      assert.ok(location.accessNotes);
      assert.ok(location.municipal);
      assert.match(location.sourceAttribution, /reported \d{4}-\d{2}-\d{2}/);
      assert.match(location.sourceAttribution, /accessed 2026-09-18/);
      assert.match(location.sourceAttribution, /https:\/\/data\.humdata\.org\/dataset\/wpdx_/);
      assert.ok(Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90);
      assert.ok(Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180);
      assert.equal(location.phone, null);
      assert.equal(location.vendorName, null);
    }
  });

  test("uses stable unique ids so startup and SQL seeding remain idempotent", () => {
    const ids = PRIORITY_LOCATION_SEEDS.map((location) => location.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id.startsWith("seed-wpdx-")));
  });
});