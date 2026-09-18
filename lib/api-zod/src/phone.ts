import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type SupportedCountryCode = CountryCode;

export const PRIORITY_COUNTRY_CODES: readonly CountryCode[] = [
  "GH",
  "KE",
  "TZ",
  "RW",
  "NG",
  "UG",
] as const;

const COUNTRY_NAMES: Record<string, string> = {
  GH: "Ghana",
  KE: "Kenya",
  TZ: "Tanzania",
  RW: "Rwanda",
  NG: "Nigeria",
  UG: "Uganda",
};

function countryName(code: CountryCode): string {
  if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface CountryOption {
  code: CountryCode;
  name: string;
  callingCode: string;
}

export const COUNTRY_OPTIONS: readonly CountryOption[] = [
  ...PRIORITY_COUNTRY_CODES,
  ...getCountries().filter((code) => !PRIORITY_COUNTRY_CODES.includes(code)),
].map((code) => ({
  code,
  name: countryName(code),
  callingCode: `+${getCountryCallingCode(code)}`,
}));

export function normalizeInternationalPhone(
  raw: string,
  defaultCountry?: CountryCode,
): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 40 || !/^[+0-9()[\].\s-]+$/.test(value)) return null;
  const parsed = parsePhoneNumberFromString(value, defaultCountry);
  if (!parsed || !parsed.isPossible() || !parsed.isValid()) return null;
  return parsed.number;
}

export function isValidInternationalPhone(
  raw: string,
  defaultCountry?: CountryCode,
): boolean {
  return normalizeInternationalPhone(raw, defaultCountry) !== null;
}

export function countryCodeFromValue(value: string | null | undefined): CountryCode | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (getCountries().includes(normalized as CountryCode)) return normalized as CountryCode;
  const match = COUNTRY_OPTIONS.find((country) => country.name.toLowerCase() === value.trim().toLowerCase());
  return match?.code;
}

export function formatPhonePlaceholder(country?: CountryCode): string {
  if (!country) return "+254 700 000000";
  return `+${getCountryCallingCode(country)} ...`;
}