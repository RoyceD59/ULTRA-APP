/**
 * UC Offline Clients
 *
 * CRUD for manually logged sales that never went through the app.
 * These entries feed into GET /api/uc/impact automatically.
 *
 * All routes require admin authentication (Bearer token).
 *
 * GET    /api/uc/offline-clients        — list all entries (newest first)
 * POST   /api/uc/offline-clients        — create a new entry
 * PUT    /api/uc/offline-clients/:id    — update an entry
 * DELETE /api/uc/offline-clients/:id   — remove an entry
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { db, ucOfflineClientsTable, teamUsersTable, type OfflineProduct } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { isAdminRequest, requireImpactEditAccess } from "../lib/adminAuth.js";
import { verifyToken } from "../lib/jwt.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Permission helpers ───────────────────────────────────────────────────────

/**
 * Returns true when the caller may READ offline clients.
 *
 * Accepted principals:
 *   - ProjectHub team-session admin (role re-verified against team_users)
 *   - ProjectHub team-session member with "view" or "edit" on the "impact" page
 *   - Any principal accepted by isAdminRequest (WooCommerce token, DB-anchored user)
 *
 * Fails closed on DB errors.
 */
async function hasImpactReadAccess(req: Request): Promise<boolean> {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) return false;

  if (claims.type === "team-session") {
    const teamId = typeof claims.id === "string" ? claims.id : "";
    if (!teamId) return false;
    try {
      const [row] = await db
        .select({
          role:        teamUsersTable.role,
          isActive:    teamUsersTable.isActive,
          permissions: teamUsersTable.permissions,
        })
        .from(teamUsersTable)
        .where(eq(teamUsersTable.id, teamId))
        .limit(1);
      if (!row || !row.isActive) return false;
      if (row.role === "admin") return true;
      const level = (row.permissions as Record<string, string> | null)?.["impact"] ?? "none";
      return level === "view" || level === "edit";
    } catch (err) {
      logger.error({ err }, "[uc/offline-clients] permission lookup failed");
      return false; // DB unavailable → fail closed
    }
  }

  // For non-team-session tokens (WooCommerce, DB-anchored uc_users) fall back
  // to the existing admin gate.
  return isAdminRequest(req.headers["authorization"]);
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/** E.164-ish phone: optional leading +, then digits/spaces/hyphens, 7–20 chars total */
function validatePhone(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return undefined; // absent → keep null in DB
  if (typeof v !== "string") return null; // invalid type → reject
  const cleaned = v.trim();
  if (cleaned === "") return undefined;
  // Allow +, digits, spaces, hyphens, parentheses — at least 7 digits present
  if (!/^\+?[\d\s\-().]{7,32}$/.test(cleaned)) return null;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 20) return null;
  return cleaned;
}

/** Permissive RFC 5322 surface check — rejects obvious non-emails */
function validateEmail(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const cleaned = v.trim().toLowerCase();
  if (cleaned === "") return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  if (cleaned.length > 255) return null;
  return cleaned;
}

function parseProducts(raw: unknown): OfflineProduct[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: OfflineProduct[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) return null;
    const item = p as Record<string, unknown>;

    // productName — required string
    if (typeof item["productName"] !== "string" || !item["productName"].trim()) return null;

    // quantity — required finite positive integer
    const qty = item["quantity"];
    if (typeof qty !== "number" || !isFinite(qty) || qty < 1 || !Number.isInteger(qty)) return null;

    // productId — optional finite non-negative integer
    if (item["productId"] !== undefined && item["productId"] !== null) {
      const pid = item["productId"];
      if (typeof pid !== "number" || !isFinite(pid) || pid < 0 || !Number.isInteger(pid)) return null;
    }

    // litresPerUnit — optional finite non-negative number
    if (item["litresPerUnit"] !== undefined && item["litresPerUnit"] !== null) {
      const lpu = item["litresPerUnit"];
      if (typeof lpu !== "number" || !isFinite(lpu) || lpu < 0) return null;
    }

    out.push({
      productName:   (item["productName"] as string).trim(),
      quantity:      qty as number,
      ...(item["productId"]    !== undefined && item["productId"]    !== null ? { productId:    item["productId"]    as number } : {}),
      ...(item["litresPerUnit"] !== undefined && item["litresPerUnit"] !== null ? { litresPerUnit: item["litresPerUnit"] as number } : {}),
    });
  }
  return out;
}

function validateDate(d: unknown): string | null {
  if (typeof d !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d;
}

function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s ?? "", 10);
  return isNaN(n) ? null : n;
}

// ─── GET /api/uc/offline-clients ─────────────────────────────────────────────

router.get("/uc/offline-clients", async (req: Request, res: Response): Promise<void> => {
  if (!(await hasImpactReadAccess(req))) {
    res.status(401).json({ error: "Impact view access required" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(ucOfflineClientsTable)
      .orderBy(desc(ucOfflineClientsTable.createdAt));
    res.json({ clients: rows });
  } catch (err) {
    console.error("[uc/offline-clients] list error:", err);
    res.status(500).json({ error: "Failed to fetch offline clients" });
  }
});

// ─── POST /api/uc/offline-clients ────────────────────────────────────────────

router.post("/uc/offline-clients", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireImpactEditAccess(req, res))) return;

  const { clientRef, products, saleDate, notes, phone, email } = req.body as Record<string, unknown>;

  const parsedProducts = parseProducts(products);
  const parsedDate     = validateDate(saleDate);
  const parsedPhone    = validatePhone(phone);
  const parsedEmail    = validateEmail(email);

  if (!parsedProducts) {
    res.status(400).json({ error: "products must be a non-empty array; each entry needs a non-empty productName, a positive integer quantity, and optional finite non-negative productId / litresPerUnit" });
    return;
  }
  if (!parsedDate) {
    res.status(400).json({ error: "saleDate must be a valid YYYY-MM-DD string" });
    return;
  }
  if (parsedPhone === null) {
    res.status(400).json({ error: "phone must be a valid phone number (7–20 digits, optional leading +)" });
    return;
  }
  if (parsedEmail === null) {
    res.status(400).json({ error: "email must be a valid email address" });
    return;
  }

  try {
    const [row] = await db
      .insert(ucOfflineClientsTable)
      .values({
        clientRef: typeof clientRef === "string" ? clientRef.trim() : "",
        phone:     parsedPhone ?? null,
        email:     parsedEmail ?? null,
        products:  parsedProducts,
        saleDate:  parsedDate,
        notes:     typeof notes === "string" ? notes.trim() : "",
      })
      .returning();
    res.status(201).json({ client: row });
  } catch (err) {
    console.error("[uc/offline-clients] create error:", err);
    res.status(500).json({ error: "Failed to create offline client entry" });
  }
});

// ─── PUT /api/uc/offline-clients/:id ─────────────────────────────────────────

router.put("/uc/offline-clients/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireImpactEditAccess(req, res))) return;

  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { clientRef, products, saleDate, notes, phone, email } = req.body as Record<string, unknown>;

  const parsedProducts = parseProducts(products);
  const parsedDate     = validateDate(saleDate);
  const parsedPhone    = validatePhone(phone);
  const parsedEmail    = validateEmail(email);

  if (!parsedProducts) {
    res.status(400).json({ error: "products must be a non-empty array; each entry needs a non-empty productName, a positive integer quantity, and optional finite non-negative productId / litresPerUnit" });
    return;
  }
  if (!parsedDate) {
    res.status(400).json({ error: "saleDate must be a valid YYYY-MM-DD string" });
    return;
  }
  if (parsedPhone === null) {
    res.status(400).json({ error: "phone must be a valid phone number (7–20 digits, optional leading +)" });
    return;
  }
  if (parsedEmail === null) {
    res.status(400).json({ error: "email must be a valid email address" });
    return;
  }

  try {
    const [row] = await db
      .update(ucOfflineClientsTable)
      .set({
        clientRef: typeof clientRef === "string" ? clientRef.trim() : "",
        phone:     parsedPhone ?? null,
        email:     parsedEmail ?? null,
        products:  parsedProducts,
        saleDate:  parsedDate,
        notes:     typeof notes === "string" ? notes.trim() : "",
      })
      .where(eq(ucOfflineClientsTable.id, id))
      .returning();

    if (!row) { res.status(404).json({ error: "Entry not found" }); return; }
    res.json({ client: row });
  } catch (err) {
    console.error("[uc/offline-clients] update error:", err);
    res.status(500).json({ error: "Failed to update offline client entry" });
  }
});

// ─── DELETE /api/uc/offline-clients/:id ──────────────────────────────────────

router.delete("/uc/offline-clients/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireImpactEditAccess(req, res))) return;

  const id = parseId(req.params["id"]);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db
      .delete(ucOfflineClientsTable)
      .where(eq(ucOfflineClientsTable.id, id))
      .returning({ id: ucOfflineClientsTable.id });

    if (!row) { res.status(404).json({ error: "Entry not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[uc/offline-clients] delete error:", err);
    res.status(500).json({ error: "Failed to delete offline client entry" });
  }
});

export default router;
