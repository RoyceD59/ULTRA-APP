/**
 * Canonical identity values shared by registration, profile updates, recovery,
 * and staff lookup. Keep customer matching deterministic across every entry
 * point so formatting differences cannot create another account.
 */
import { normalizeInternationalPhone } from "@workspace/api-zod/phone";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns an E.164-style phone value or null when the supplied value is not a
 * valid international number. Separators are accepted, but national/local
 * formats are deliberately not guessed.
 */
export function normalizePhone(value: string): string | null {
  return normalizeInternationalPhone(value);
}

export function phoneValidationMessage(): string {
  return "Enter a valid phone number in international format, e.g. +254712345678";
}