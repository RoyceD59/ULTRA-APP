import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COUNTRY_OPTIONS,
  PRIORITY_COUNTRY_CODES,
  normalizeInternationalPhone,
} from "@workspace/api-zod/phone";

describe("global phone normalization", () => {
  it("keeps the launch countries first while retaining worldwide countries", () => {
    assert.deepEqual(COUNTRY_OPTIONS.slice(0, 6).map((country) => country.code), PRIORITY_COUNTRY_CODES);
    assert.ok(COUNTRY_OPTIONS.length > 200);
    assert.ok(COUNTRY_OPTIONS.some((country) => country.code === "US"));
    assert.ok(COUNTRY_OPTIONS.some((country) => country.code === "IN"));
  });

  it("normalizes valid numbers for priority and representative global markets", () => {
    const cases = [
      ["024 123 4567", "GH", "+233241234567"],
      ["0712 345678", "KE", "+254712345678"],
      ["0712 345 678", "TZ", "+255712345678"],
      ["0788 123 456", "RW", "+250788123456"],
      ["0803 123 4567", "NG", "+2348031234567"],
      ["0772 123456", "UG", "+256772123456"],
      ["+1 415 555 2671", "US", "+14155552671"],
      ["+44 20 7946 0018", "GB", "+442079460018"],
      ["+91 98765 43210", "IN", "+919876543210"],
    ] as const;

    for (const [raw, country, expected] of cases) {
      assert.equal(normalizeInternationalPhone(raw, country), expected, `${country}: ${raw}`);
    }
  });

  it("rejects impossible, empty, and non-phone input", () => {
    assert.equal(normalizeInternationalPhone("", "KE"), null);
    assert.equal(normalizeInternationalPhone("123", "KE"), null);
    assert.equal(normalizeInternationalPhone("call-me-now", "GH"), null);
  });
});