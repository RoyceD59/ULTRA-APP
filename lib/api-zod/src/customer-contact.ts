import { normalizeInternationalPhone, countryCodeFromValue } from "./phone";

/** Contact is logistics information, never proof of account or purchase ownership. */
export function validateCustomerContact(input: { phone?: unknown; address?: unknown; country?: unknown }) {
  const fields: Record<string, string> = {};
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const phone = typeof input.phone === "string"
    ? normalizeInternationalPhone(input.phone, countryCodeFromValue(typeof input.country === "string" ? input.country : undefined) ?? "KE") : null;
  if (!address) fields.address = "Enter your contact address.";
  else if (address.length > 500) fields.address = "Address must be 500 characters or fewer.";
  if (!phone) fields.phone = "Enter a valid phone number for the selected country.";
  return { ok: Object.keys(fields).length === 0, fields, address, phone };
}