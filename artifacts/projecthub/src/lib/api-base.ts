/**
 * Central API origin for ProjectHub.
 *
 * The API is a separate hostname in production. Development intentionally
 * falls back to same-origin so Vite's existing /api proxy continues to work.
 * VITE_API_BASE_URL may be an origin or an origin ending in /api; the
 * normalized value exported here is always the origin.
 */
export interface ApiEnvironment {
  VITE_API_DOMAIN?: string;
  VITE_API_BASE_URL?: string;
  PROD?: boolean;
}

const PRODUCTION_API_ORIGIN = "https://api.ucfilters.com";

export function resolveApiOrigin(env: ApiEnvironment): string {
  const configured = env.VITE_API_BASE_URL?.trim() || env.VITE_API_DOMAIN?.trim();
  if (!configured) return env.PROD ? PRODUCTION_API_ORIGIN : "";

  let origin = configured;
  if (origin.startsWith("/")) return origin.replace(/\/+$/, "").replace(/\/api$/i, "");
  if (origin.startsWith("//")) origin = `https:${origin}`;
  else if (!/^https?:\/\//i.test(origin) && origin !== "") origin = `https://${origin}`;

  return origin
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

export const API_ORIGIN = resolveApiOrigin(import.meta.env);
export const API_BASE_URL = `${API_ORIGIN}/api`;

/** Build an API URL from either /path or /api/path notation. */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/api/")
    ? path.slice(4)
    : path === "/api"
      ? ""
      : path.startsWith("/")
        ? path
        : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}