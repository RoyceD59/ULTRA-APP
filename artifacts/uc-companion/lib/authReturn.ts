/**
 * Return-destination handling for the auth screens.
 *
 * When a guest is sent to sign-in / registration from a form (service
 * request, water test), the origin screen passes `returnTo` so successful
 * authentication navigates BACK to the form (which restores its draft)
 * instead of replacing to the home tabs.
 *
 * Only a fixed allow-list of in-app paths is honoured, so a malformed or
 * malicious param can never navigate anywhere unexpected.
 */

const ALLOWED_RETURN_PATHS = ['/ticket/new', '/water-test', '/account?editProfile=1'] as const;

export type AllowedReturnPath = (typeof ALLOWED_RETURN_PATHS)[number];

/** Normalise the raw route param and return a safe path, or null. */
export function resolveReturnTo(raw: string | string[] | undefined): AllowedReturnPath | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return (ALLOWED_RETURN_PATHS as readonly string[]).includes(value)
    ? (value as AllowedReturnPath)
    : null;
}
