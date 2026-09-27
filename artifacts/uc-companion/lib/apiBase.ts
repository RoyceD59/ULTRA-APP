/**
 * Resolve the API origin injected into the Companion bundle.
 *
 * EXPO_PUBLIC_DOMAIN remains the deployment origin used by the Expo web
 * artifact. Production API calls use the separate API hostname, while the
 * fallback keeps the existing Replit development setup working.
 */
export function getApiBase(): string {
  const configured = (
    process.env.EXPO_PUBLIC_API_DOMAIN
    || process.env.EXPO_PUBLIC_DOMAIN
    || ''
  ).trim();

  if (process.env.NODE_ENV === 'production' && !process.env.EXPO_PUBLIC_API_DOMAIN?.trim()) {
    throw new Error(
      'Companion production build is missing EXPO_PUBLIC_API_DOMAIN',
    );
  }

  if (!configured) return '';

  const withoutTrailingSlash = configured.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }

  // The local EAS development profile uses localhost:8080. Use HTTP there;
  // public Replit and production origins are HTTPS.
  const protocol = /^(localhost|127(?:\.\d{1,3}){3})(?::\d+)?$/i.test(withoutTrailingSlash)
    ? 'http'
    : 'https';
  return `${protocol}://${withoutTrailingSlash}`;
}