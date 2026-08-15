/**
 * Router-level guard: reject any /uc/* request carrying a valid bearer token
 * whose uc_users row has deleted_at set.
 *
 * Account deletion anonymises the user row, but the JWT itself stays
 * cryptographically valid until expiry. Individual routes that write data are
 * DB-anchored and already reject deleted accounts, but read-only or
 * fallback-tolerant endpoints could still honour the stale token. This
 * middleware closes that window centrally for every /uc/* route, in every
 * route file, present and future.
 *
 * Rules:
 *  - Only applies to /uc/* paths (relative to the /api mount).
 *  - Only applies when the request carries a *valid* uc customer token.
 *    Requests without an Authorization header, with invalid tokens, or with
 *    ProjectHub team-session tokens pass through untouched (routes handle
 *    their own auth semantics).
 *  - Non-DB-anchored identities (legacy timestamp IDs, mock logins) skip the
 *    check — they have no uc_users row to be deleted.
 *  - DELETE /uc/customer is exempt so duplicate deletion requests stay
 *    idempotent (they must return 200 { alreadyDeleted: true }, not 401).
 *  - Fails CLOSED for DB-anchored tokens: if the DB is unavailable we return
 *    503 rather than letting a possibly-erased identity through.
 */
import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt.js";
import { pool } from "@workspace/db";

/** True when the numeric id looks like a real serial uc_users id. */
function isDbAnchoredId(id: number): boolean {
  return !isNaN(id) && id > 0 && id < 1_000_000_000;
}

export async function rejectDeletedUcAccounts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Only guard UC customer routes.
  if (!req.path.startsWith("/uc/") && req.path !== "/uc") {
    next();
    return;
  }
  // Exempt the deletion route itself — duplicate DELETEs must stay idempotent.
  if (req.method === "DELETE" && req.path === "/uc/customer") {
    next();
    return;
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    next();
    return;
  }
  const claims = verifyToken(authHeader);
  // Invalid/forged tokens: let each route apply its own 401 semantics.
  if (!claims) {
    next();
    return;
  }
  // ProjectHub team-session tokens are not uc customers.
  if (claims.type === "team-session") {
    next();
    return;
  }
  const numericId = Number(claims.id);
  if (!isDbAnchoredId(numericId)) {
    next();
    return;
  }

  try {
    const result = await pool.query<{ deleted_at: string | null }>(
      "SELECT deleted_at FROM uc_users WHERE id = $1 LIMIT 1",
      [numericId]
    );
    if (result.rows[0]?.deleted_at) {
      res.status(401).json({ error: "This account has been deleted" });
      return;
    }
    next();
  } catch {
    // DB unavailable — fail closed so an erased identity can never be
    // reactivated by a transient outage.
    res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
  }
}
