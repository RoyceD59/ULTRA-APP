import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCountries, getCountryCallingCode, parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";
import {
  COUNTRY_OPTIONS, PRIORITY_COUNTRY_CODES, countryCodeFromValue,
  formatPhonePlaceholder, normalizeInternationalPhone, isValidInternationalPhone,
} from "../src/phone";
import {
  normalizeInstantPhone, normalizeInstantKenyanPhone,
  instantWaterPhoneSchema, instantWaterKenyanPhoneSchema,
} from "../src/instant-water-identity";
import { normalizePhone } from "../../../artifacts/api-server/src/lib/customer-identity";
import { validatePhone, validateCodShipping } from "../../../artifacts/api-server/src/lib/order-validation";

// Reference the pre-optimization API, including its exact validation strength.
function originalNormalize(raw: string, country?: CountryCode): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 40 || !/^[+0-9()[\].\s-]+$/.test(value)) return null;
  const parsed = parsePhoneNumberFromString(value, country);
  return parsed?.isPossible() && parsed.isValid() ? parsed.number : null;
}

function originalInstant(raw: string, country?: CountryCode): string | null {
  const value = raw.trim();
  if (value.length < 7 || value.length > 40 || !/^\+?[0-9() .-]+$/.test(value)) return null;
  if (!/^(?:\+|[0-9(])/.test(value) || !/[0-9]$/.test(value) || /[ .-]{2,}/.test(value)) return null;
  if (value.startsWith("+") && value.indexOf("+", 1) !== -1) return null;
  const normalized = originalNormalize(value, country ?? "KE");
  if (!normalized || !country || !value.startsWith("+")) return normalized;
  return parsePhoneNumberFromString(value, country)?.country === country ? normalized : null;
}

describe("phone policy compatibility", () => {
  it("preserves every worldwide country, calling code, priority, name lookup and placeholder", () => {
    const codes = [...PRIORITY_COUNTRY_CODES, ...getCountries().filter(c => !PRIORITY_COUNTRY_CODES.includes(c))];
    assert.deepEqual(COUNTRY_OPTIONS.map(c => c.code), codes);
    for (const c of COUNTRY_OPTIONS) {
      assert.equal(c.callingCode, `+${getCountryCallingCode(c.code)}`);
      assert.equal(countryCodeFromValue(` ${c.code.toLowerCase()} `), c.code);
      assert.equal(countryCodeFromValue(c.name), c.code);
      assert.equal(formatPhonePlaceholder(c.code), `${c.callingCode} ...`);
    }
    assert.equal(countryCodeFromValue("not a country"), undefined);
    assert.equal(formatPhonePlaceholder(), "+254 700 000000");
  });

  it("matches the original parser for all upstream mobile examples and invalid variants", () => {
    let validExamples = 0;
    for (const country of getCountries()) {
      const number = examples[country];
      if (!number) continue;
      const international = `+${getCountryCallingCode(country)}${number}`;
      const cases = [
        number, international, ` ${international} `, `${number.slice(0, 3)}-${number.slice(3)}`,
        number.slice(0, -1), `${number}99999`, `+${getCountryCallingCode(country)}000000000`,
        `00${international.slice(1)}`, `tel:${international}`, `${international} ext 1`,
      ];
      if (originalNormalize(international, country)) validExamples++;
      for (const raw of cases) {
        assert.equal(normalizeInternationalPhone(raw, country), originalNormalize(raw, country), `${country}: ${raw}`);
        assert.equal(normalizeInternationalPhone(raw), originalNormalize(raw), `no default: ${raw}`);
        assert.equal(isValidInternationalPhone(raw, country), originalNormalize(raw, country) !== null);
        assert.equal(normalizeInstantPhone(raw, country), originalInstant(raw, country), `selected: ${country}: ${raw}`);
        assert.equal(normalizeInstantPhone(raw), originalInstant(raw), `legacy default: ${raw}`);
      }
    }
    assert.ok(validExamples > 200, "exercise worldwide valid numbers, not only invalid comparisons");
  });

  it("keeps exact launch-market and global normalization", () => {
    const cases = [
      ["024 123 4567", "GH", "+233241234567"],
      ["0712 345 678", "KE", "+254712345678"],
      ["0112345678", "KE", "+254112345678"],
      ["0712 345 678", "TZ", "+255712345678"],
      ["0788 123 456", "RW", "+250788123456"],
      ["0803 123 4567", "NG", "+2348031234567"],
      ["0772 123456", "UG", "+256772123456"],
      ["020 7946 0018", "GB", "+442079460018"],
      ["(415) 555-2671", "US", "+14155552671"],
      ["98765 43210", "IN", "+919876543210"],
    ] as const;
    for (const [raw, country, expected] of cases) {
      assert.equal(normalizeInternationalPhone(raw, country), expected);
      assert.equal(normalizeInstantPhone(raw, country), expected);
      assert.equal(validatePhone(raw, country).normalized, expected);
    }
  });

  it("does not weaken validity, character, length, or selected-country checks", () => {
    for (const raw of ["", "123", "++254712345678", "+254712345678x", "call +254712345678",
      "+254712345678 ext 1", "+254712345678\n123", "9".repeat(41), "１２３４５６７８９", "+999712345678"]) {
      assert.equal(normalizeInternationalPhone(raw, "KE"), null, raw);
      assert.equal(normalizeInstantPhone(raw, "KE"), null, raw);
    }
    const possibleButInvalid = "+12001230101";
    assert.equal(parsePhoneNumberFromString(possibleButInvalid)?.isPossible(), true);
    assert.equal(normalizeInternationalPhone(possibleButInvalid), null);
    assert.equal(normalizeInstantPhone("+255712345678", "KE"), null);
    assert.equal(normalizeInstantPhone("+255712345678", "TZ"), "+255712345678");
    assert.equal(normalizeInstantPhone("0712  345678", "KE"), null);
    assert.equal(normalizeInstantPhone("0712.345.678", "KE"), "+254712345678");
    assert.equal(normalizeInstantPhone("[0712345678]", "KE"), null);
    assert.equal(normalizeInstantPhone("+14165552671", "US"), null); // shared +1, Canada
    assert.equal(normalizeInstantPhone("+14165552671", "CA"), "+14165552671");
  });

  it("retains legacy identity and Kenya-only compatibility without guessing local identities", () => {
    assert.equal(normalizePhone("0712 345 678"), null);
    assert.equal(normalizePhone("254712345678"), null);
    assert.equal(normalizePhone("+254 (712) 345-678"), "+254712345678");
    assert.equal(normalizeInstantPhone("0712 345 678"), "+254712345678");
    assert.equal(normalizeInstantPhone("254712345678", "KE"), "+254712345678");
    assert.equal(normalizeInstantKenyanPhone("0112345678"), "+254112345678");
    assert.equal(normalizeInstantKenyanPhone("0800 123 456"), null);
    assert.equal(normalizeInstantKenyanPhone("+255712345678"), null);
    assert.equal(instantWaterPhoneSchema.parse("0712 345 678"), "+254712345678");
    assert.equal(instantWaterPhoneSchema.parse("+255712345678"), "+255712345678");
    assert.equal(instantWaterKenyanPhoneSchema.safeParse("+255712345678").success, false);
  });

  it("preserves checkout country-name resolution, normalized transport and invalid rejection", () => {
    assert.equal(validatePhone("0712 345 678").valid, false);
    assert.equal(validatePhone("0241234567", "Ghana").normalized, "+233241234567");
    const shipping = { firstName: "Amina", lastName: "Otieno", phone: "0712 345 678", country: "Kenya" };
    assert.deepEqual(validateCodShipping(shipping), { ok: true, fields: {}, normalizedPhone: "+254712345678" });
    assert.equal(validateCodShipping({ ...shipping, phone: "123" }).ok, false);
  });
});