/**
 * Input validation for Cash-on-Delivery (COD) orders.
 *
 * COD is the only payment method with no payment barrier — anyone can submit
 * an order with mashed-keyboard names and a junk phone number, and the team
 * then wastes time calling dead numbers. Verified-payment methods (M-Pesa,
 * Paystack, Stripe) are deliberately NOT gated on these checks: a confirmed
 * payment already establishes genuine intent, and rejecting a paid order
 * would be far worse than a sloppy name.
 *
 * Heuristics are intentionally gentle — they block obvious junk ("hjkhjk",
 * "asdf", "12345") without rejecting real names (Ng'ang'a, Ngũgĩ, Jean-Paul).
 */

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
 * Kenyan numbers (07XX/01XX local, 254… or +254… international) normalize to
 * +254XXXXXXXXX; other international numbers are accepted as +<10-15 digits>.
 */
export function validatePhone(raw: string): { valid: boolean; normalized?: string } {
  const cleaned = raw.replace(/[\s().-]/g, "");
  if (!cleaned) return { valid: false };
  const kenyan = cleaned.match(/^(?:\+254|254|0)([71]\d{8})$/);
  if (kenyan) return { valid: true, normalized: `+254${kenyan[1]}` };
  if (/^\+[1-9]\d{9,14}$/.test(cleaned)) return { valid: true, normalized: cleaned };
  return { valid: false };
}

export interface CodShippingValidation {
  ok: boolean;
  /** Per-field, human-readable messages — safe to show directly to the customer. */
  fields: Record<string, string>;
  /** Present when ok — phone in normalized international form. */
  normalizedPhone?: string;
}

/**
 * Validate the shipping details of a COD order.
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
    const check = validatePhone(phone);
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
