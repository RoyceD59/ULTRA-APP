/**
 * Shared identity validation for instant water-check submissions.
 *
 * The API remains authoritative, but the pure helpers are also used by the
 * public web and Companion forms so they present the same policy before a
 * request is sent.
 */
import { z } from "zod";
import { normalizeInternationalPhone, type SupportedCountryCode } from "./phone";

const FIRST_NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:[ '\u2019-]\p{L}[\p{L}\p{M}]*)*$/u;
const REPEATED_CHARACTER_PATTERN = /([\p{L}\p{M}])\1{2,}/iu;
const PHONE_CHARACTERS_PATTERN = /^\+?[0-9() .-]+$/;

export function normalizeInstantFirstName(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().normalize("NFC");
  const characterCount = Array.from(value).length;
  if (characterCount < 2 || characterCount > 80) return null;
  if (!FIRST_NAME_PATTERN.test(value) || REPEATED_CHARACTER_PATTERN.test(value)) return null;
  return value;
}

export function isValidInstantFirstName(raw: string): boolean {
  return normalizeInstantFirstName(raw) !== null;
}

export function normalizeInstantPhone(raw: string, country: SupportedCountryCode = "KE"): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length < 7 || value.length > 40 || !PHONE_CHARACTERS_PATTERN.test(value)) return null;
  if (!/^(?:\+|[0-9(])/.test(value) || !/[0-9]$/.test(value) || /[ .-]{2,}/.test(value)) return null;
  if (value.startsWith("+") && value.indexOf("+", 1) !== -1) return null;
  return normalizeInternationalPhone(value, country);
}

export function normalizeInstantKenyanPhone(raw: string): string | null {
  return normalizeInstantPhone(raw, "KE");
}

export function isValidInstantPhone(raw: string, country: SupportedCountryCode = "KE"): boolean {
  return normalizeInstantPhone(raw, country) !== null;
}

export function isValidInstantKenyanPhone(raw: string): boolean {
  return normalizeInstantKenyanPhone(raw) !== null;
}

export const instantWaterFirstNameSchema = z.string().transform((value, context) => {
  const normalized = normalizeInstantFirstName(value);
  if (!normalized) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter a valid first name",
    });
    return z.NEVER;
  }
  return normalized;
});

export const instantWaterKenyanPhoneSchema = z.string().transform((value, context) => {
  const normalized = normalizeInstantKenyanPhone(value);
  if (!normalized) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter a valid Kenyan mobile number",
    });
    return z.NEVER;
  }
  return normalized;
});