/**
 * Construct the base URL of this API server for UC password-reset links.
 *
 * Priority order:
 *   1. UC_RESET_BASE_URL    — explicit operator override (staging, custom domain)
 *   2. REPLIT_DOMAINS       — canonical public domain set by Replit in deployed
 *                             environments; comma-separated, first entry wins.
 *   3. REPLIT_DEV_DOMAIN    — Replit preview/dev proxy (workspace sessions)
 *   4. localhost fallback   — local development only
 *
 * Production accepts only a validated HTTPS public explicit URL or
 * REPLIT_DOMAINS. A missing or unsafe origin is a configuration error, so an
 * unusable localhost or preview link can never be emailed to a customer.
 *
 * Exported so it can be unit-tested independently of the route file.
 */
export function ucApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const isProduction = env["NODE_ENV"] === "production";
  const explicitBase = env["UC_RESET_BASE_URL"];
  if (explicitBase) {
    const base = explicitBase.replace(/\/$/, "");
    if (isProduction) assertPublicHttpsUrl(base);
    return base;
  }

  const replitDomains = env["REPLIT_DOMAINS"];
  if (replitDomains) {
    const first = replitDomains.split(",")[0]!.trim();
    const base = `https://${first}/api`;
    if (isProduction) assertPublicHttpsUrl(base);
    return base;
  }

  // REPLIT_DEV_DOMAIN is an ephemeral preview origin. It must never be sent to
  // customers from a production deployment, even if it is accidentally set.
  const devDomain = env["REPLIT_DEV_DOMAIN"];
  if (devDomain && !isProduction) {
    return `https://${devDomain}/api`;
  }
  if (isProduction) {
    throw new Error(
      "Cannot generate a password-reset URL in production: set UC_RESET_BASE_URL or REPLIT_DOMAINS.",
    );
  }
  // Localhost is permitted only for explicit non-production local development.
  return "http://localhost:8080/api";
}

/** Reject origins that could not possibly work as a public recovery link. */
function assertPublicHttpsUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("UC_RESET_BASE_URL must be a valid HTTPS public URL in production.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const localHost = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "::1"
    || hostname.startsWith("127.");
  if (parsed.protocol !== "https:" || localHost || parsed.username || parsed.password) {
    throw new Error("UC_RESET_BASE_URL must be an HTTPS public URL in production.");
  }
}
