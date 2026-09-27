/**
 * Minimal HMAC-SHA256 ("HS256") JWT utilities.
 *
 * Only used for tokens we issue ourselves (mock login + register paths).
 * WooCommerce tokens are re-wrapped into our format so they are also
 * verifiable by us before use.
 *
 * Uses Node.js built-in `crypto` — no external dependencies.
 */
import { createHmac, timingSafeEqual } from "crypto";

const ALG_HEADER = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");

function secret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) {
    throw new Error("[jwt] SESSION_SECRET is not set — cannot sign or verify tokens");
  }
  return s;
}

function sign(headerDotBody: string): string {
  return createHmac("sha256", secret())
    .update(headerDotBody)
    .digest("base64url");
}

/** Issue a signed JWT containing `payload` as the claims. */
export function issueToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${ALG_HEADER}.${body}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export interface JwtClaims {
  id:        number | string;
  email:     string;
  firstName?: string;
  lastName?:  string;
  name?:      string; // ProjectHub display name
  type?:      string; // e.g. "team-session" for ProjectHub team auth
  role?:      string; // "admin" | "member" for ProjectHub users
  /**
   * Token provenance, set at issue time and never client-controlled.
   * "woo" = the email was verified by WooCommerce at login. Absent on
   * DB-backed logins and on the dev ephemeral-login fallback, so admin
   * gates can trust `email` against UC_ADMIN_EMAILS ONLY when src === "woo".
   */
  src?:       string;
  exp?:       number;
  /** Monotonically-increasing credential version for DB-anchored UC customer
   *  accounts. Incremented on password reset so pre-reset tokens are rejected
   *  by the UC deleted-account guard. Absent on WooCommerce, mock, and
   *  ProjectHub team-session tokens. */
  credentialVersion?: number;
  /** Temporary admin-issued credential sessions may only complete the
   * permanent-password change flow. */
  mustChangePassword?: boolean;
}

/**
 * Verify a Bearer JWT issued by this server.
 * Returns the decoded claims on success, or null if the signature is invalid,
 * the token is malformed, the algorithm is `none`, or the token has expired.
 */
export function verifyToken(authHeader: string | undefined): JwtClaims | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, givenSig] = parts as [string, string, string];

  // Reject unsigned tokens ("alg": "none")
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: string };
    if (h.alg === "none" || !h.alg) return null;
  } catch {
    return null;
  }

  let expected: string;
  try {
    expected = sign(`${header}.${body}`);
  } catch {
    // SESSION_SECRET not set — cannot verify
    return null;
  }

  // Use timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(expected, "base64url");
    const b = Buffer.from(givenSig, "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtClaims;

    // Enforce expiry claim: reject tokens past their exp timestamp
    if (claims.exp !== undefined && claims.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}
