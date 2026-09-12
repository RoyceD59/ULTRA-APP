/**
 * Shared admin-auth helper for UC routes.
 *
 * isAdminRequest   — returns true only for three, explicitly distinguished
 *                    principal kinds. Fails closed on any error.
 * requireAdmin     — convenience wrapper: sends 401 and returns false when the
 *                    caller is not an admin, so route handlers can early-return.
 *
 * Accepted principals:
 *   1. ProjectHub team sessions (`type: "team-session"`) — the admin role is
 *      RE-VERIFIED against the live team_users row on every request, never
 *      trusted from JWT claims, so demotions/deactivations take effect
 *      immediately instead of at token expiry.
 *   2. WooCommerce-issued tokens (`src: "woo"`) — the email was verified by
 *      WooCommerce at issue time (provenance claim set only by the Woo login
 *      path), so it may be checked against the UC_ADMIN_EMAILS allowlist.
 *      Dev ephemeral-login fallback tokens mint arbitrary emails with
 *      Date.now() ids in the same >= 1e9 range but never carry `src: "woo"`,
 *      so they remain rejected.
 *   3. DB-anchored uc_users accounts — the bearer token must resolve to a real
 *      registered user row (id < 1e9); admin comes from the row's isAdmin flag
 *      or its (DB-stored) email being on the allowlist.
 *
 * Admin is NEVER derived from JWT claims alone.
 */
import { type Request, type Response } from "express";
import { db, ucUsersTable, teamUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken } from "./jwt.js";

export const IMPACT_EDIT_ERROR = {
  error: "Your UC Impact edit access has changed. Refresh your ProjectHub permissions to continue.",
  code: "IMPACT_EDIT_ACCESS_REQUIRED",
} as const;

export function adminEmailList(): string[] {
  return (process.env["UC_ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdminRequest(authHeader: string | undefined): Promise<boolean> {
  const claims = verifyToken(authHeader);
  if (!claims) return false;

  // ── 1. ProjectHub team session — role re-verified against team_users ──────
  // (The legacy passcode token has id "team" with no DB row, so it is
  // rejected here by design — only individual team-admin accounts pass.)
  if (claims.type === "team-session") {
    const teamId = typeof claims.id === "string" ? claims.id : "";
    if (!teamId) return false;
    try {
      const [row] = await db
        .select({ role: teamUsersTable.role, isActive: teamUsersTable.isActive })
        .from(teamUsersTable)
        .where(eq(teamUsersTable.id, teamId))
        .limit(1);
      return !!row && row.isActive && row.role === "admin";
    } catch {
      return false; // DB unavailable → fail closed
    }
  }

  // ── 2. WooCommerce-issued token — email verified by Woo at issue time ─────
  if (claims.src === "woo") {
    const email = typeof claims.email === "string" ? claims.email.toLowerCase().trim() : "";
    return email.length > 0 && adminEmailList().includes(email);
  }

  // ── 3. DB-anchored uc_users account ───────────────────────────────────────
  // Synthetic principals (Woo without provenance, dev fallback) land >= 1e9
  // and are rejected before any DB lookup.
  const numericId = Number(claims.id);
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) return false;

  try {
    const dbUser = await db.query.ucUsersTable.findFirst({
      where: eq(ucUsersTable.id, numericId),
    });
    if (!dbUser) return false;
    return dbUser.isAdmin || adminEmailList().includes(dbUser.email.toLowerCase());
  } catch {
    return false; // DB unavailable → fail closed
  }
}

/** Sends 401 and returns false when the caller is not an admin. */
export async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const ok = await isAdminRequest(req.headers["authorization"]);
  if (!ok) {
    res.status(401).json({ error: "Admin authentication required" });
    return false;
  }
  return true;
}

/** Re-checks live ProjectHub impact edit access while preserving non-team admin support. */
export async function requireImpactEditAccess(req: Request, res: Response): Promise<boolean> {
  const claims = verifyToken(req.headers["authorization"]);
  if (claims?.type !== "team-session") {
    return requireAdmin(req, res);
  }

  const teamId = typeof claims.id === "string" ? claims.id : "";
  if (!teamId) {
    res.status(401).json({ error: "Admin authentication required" });
    return false;
  }

  try {
    const [row] = await db
      .select({
        role: teamUsersTable.role,
        isActive: teamUsersTable.isActive,
        permissions: teamUsersTable.permissions,
      })
      .from(teamUsersTable)
      .where(eq(teamUsersTable.id, teamId))
      .limit(1);

    if (!row || !row.isActive) {
      res.status(401).json({ error: "Admin authentication required" });
      return false;
    }
    if (row.role === "admin") return true;

    const level = (row.permissions as Record<string, string> | null)?.["impact"] ?? "none";
    if (level === "edit") return true;

    res.status(403).json(IMPACT_EDIT_ERROR);
    return false;
  } catch {
    res.status(503).json({ error: "Could not verify UC Impact edit access" });
    return false;
  }
}
