/**
 * Input validation for checkout delivery details.
 *
 * COD additionally uses the name heuristics below because it has no payment
 * barrier. Phone parsing is shared by every checkout method and happens before
 * any provider or persistence call.
 *
 * Heuristics are intentionally gentle — they block obvious junk ("hjkhjk",
 * "asdf", "12345") without rejecting real names (Ng'ang'a, Ngũgĩ, Jean-Paul).
 */
import { normalizeInternationalPhone, countryCodeFromValue } from "@workspace/api-zod/phone";

/** Keyboard-row runs that indicate mashing rather than a real name. */
const KEYBOARD_RUNS = [
  "qwer", "wert", "erty", "rtyu", "tyui", "yuio", "uiop",
  "asdf", "sdfg", "dfgh", "fghj", "ghjk", "hjkl",
  "zxcv", "xcvb", "cvbn", "vbnm",
];

/** Strip diacritics so accented vowels (Ngũgĩ) count as vowels. */
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * True when a string plausibly is a person's name.
 * Rules: 2-60 chars; letters/spaces/hyphens/apostrophes/periods only;
 * contains a vowel; no character repeated 3+ times in a row; no
 * keyboard-row runs (asdf, hjkl, …).
 */
export function looksLikeRealName(raw: string): boolean {
  const name = raw.trim();
  if (name.length < 2 || name.length > 60) return false;
  // Must start with a letter; letters, spaces, hyphens, apostrophes, periods only.
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(name)) return false;
  const plain = deaccent(name).toLowerCase();
  // Real names contain vowels ("hjkhjk" does not). y counts (Kym, Wyn).
  if (!/[aeiouy]/.test(plain)) return false;
  // Same character 3+ times in a row ("aaaa", "mmm") is keyboard mashing.
  if (/(.)\1\1/.test(plain)) return false;
  if (KEYBOARD_RUNS.some((run) => plain.includes(run))) return false;
  return true;
}

/**
 * Validate and normalize a phone number.
 * Local numbers are parsed only when a valid submitted country is available;
 * international numbers may use their + prefix.
 */
export function validatePhone(raw: string, country?: string): { valid: boolean; normalized?: string } {
  const normalized = normalizeInternationalPhone(raw, countryCodeFromValue(country));
  return normalized ? { valid: true, normalized } : { valid: false };
}

export interface CodShippingValidation {
  ok: boolean;
  /** Per-field, human-readable messages — safe to show directly to the customer. */
  fields: Record<string, string>;
  /** Present when ok — phone in normalized international form. */
  normalizedPhone?: string;
}

/**
 * Validate the shipping details of a COD order after universal phone parsing.
 * Requires a plausible first name and a valid phone number; the last name is
 * validated only when provided (older app versions do not require it).
 */
export function validateCodShipping(
  shipping: Record<string, unknown> | undefined,
): CodShippingValidation {
  const fields: Record<string, string> = {};
  if (!shipping || typeof shipping !== "object" || Array.isArray(shipping)) {
    return { ok: false, fields: { shippingAddress: "Delivery details are required for cash orders." } };
  }
  // Direct API callers can send anything — treat non-string values as absent
  // so malformed input yields a friendly 400, never an exception.
  const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const firstName = asString(shipping["firstName"]);
  const lastName = asString(shipping["lastName"]);
  const phone = asString(shipping["phone"]);
  const country = asString(shipping["country"]);

  if (!firstName) {
    fields["firstName"] = "First name is required for cash orders.";
  } else if (!looksLikeRealName(firstName)) {
    fields["firstName"] = "Please enter your real first name.";
  }
  if (lastName && !looksLikeRealName(lastName)) {
    fields["lastName"] = "Please enter your real last name.";
  }
  let normalizedPhone: string | undefined;
  if (!phone) {
    fields["phone"] = "A phone number is required for cash orders.";
  } else {
    const check = validatePhone(phone, country);
    if (!check.valid) {
      fields["phone"] = "Please enter a valid phone number, e.g. 0712 345 678.";
    } else {
      normalizedPhone = check.normalized;
    }
  }

  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, fields, normalizedPhone };
}
