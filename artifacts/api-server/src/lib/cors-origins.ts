/**
 * buildCorsOrigins
 *
 * Constructs the list of allowed CORS origins from the environment.
 * Extracted from app.ts so it can be imported and exercised by tests
 * without duplicating the logic.
 *
 * Rules:
 *   – In production, only the two public Ultra-Clear web apps are allowed.
 *   – Outside production, the Replit Expo and generic dev-domain origins
 *     are allowed when the corresponding env vars are present.
 *   – Returns false (not an empty array) when no origins resolve, so the
 *     cors() middleware keeps the header absent rather than sending "*".
 */
export function buildCorsOrigins(
  env: Record<string, string | undefined>,
): string[] | false {
  if (env["NODE_ENV"] === "production") {
    return [
      "https://app.ucfilters.com",
      "https://hub.ucfilters.com",
    ];
  }

  const origins: string[] = [];
  for (const domain of [env["REPLIT_EXPO_DEV_DOMAIN"], env["REPLIT_DEV_DOMAIN"]]) {
    if (domain) origins.push(`https://${domain}`);
  }
  return origins.length > 0 ? origins : false;
}
