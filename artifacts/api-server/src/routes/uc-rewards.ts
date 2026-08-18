/**
 * UC Rewards — admin rules panel + customer balance endpoint.
 *
 * Admin routes (Bearer token — team admin or UC admin):
 *   GET    /uc/admin/rewards/rules               — list all reward rules
 *   PATCH  /uc/admin/rewards/rules/:id           — update pointsValue or active
 *   POST   /uc/admin/rewards/grant               — manually award points to a user
 *   GET    /uc/admin/rewards/balances            — customer balances, sorted desc, optional ?search=
 *   GET    /uc/admin/rewards/ledger              — full ledger, optional ?userId=&export=1
 *
 * Customer route (Bearer token — any authenticated UC user):
 *   GET    /uc/customer/rewards          — returns { balance, ledger: last 20 }
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, ucRewardsRulesTable, ucRewardsLedgerTable, ucUsersTable } from "@workspace/db";
import { eq, desc, sql, or, and, isNull, ilike } from "drizzle-orm";
import { requireAdmin } from "../lib/adminAuth.js";
import { verifyToken } from "../lib/jwt.js";
import { sendPushToUser } from "../lib/push.js";

const router: IRouter = Router();

// ─── Customer: GET /uc/customer/rewards ───────────────────────────────────────

router.get("/uc/customer/rewards", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  const userId = claims ? Number(claims.id) : 0;
  if (!userId || isNaN(userId) || userId <= 0 || userId >= 1_000_000_000) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Confirm user exists and is not deleted
  const [user] = await db
    .select({ id: ucUsersTable.id })
    .from(ucUsersTable)
    .where(and(eq(ucUsersTable.id, userId), isNull(ucUsersTable.deletedAt)))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const [balanceRow] = await db
      .select({ balance: sql<number>`COALESCE(SUM(${ucRewardsLedgerTable.points}), 0)` })
      .from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, userId));

    const ledger = await db
      .select()
      .from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, userId))
      .orderBy(desc(ucRewardsLedgerTable.createdAt))
      .limit(20);

    res.json({
      balance: Number(balanceRow?.balance ?? 0),
      ledger,
    });
  } catch (err) {
    console.error("[uc/customer/rewards] error:", err);
    res.status(500).json({ error: "Failed to fetch rewards" });
  }
});

// ─── Admin: GET /uc/admin/rewards/rules ──────────────────────────────────────

router.get("/uc/admin/rewards/rules", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const rules = await db
      .select()
      .from(ucRewardsRulesTable)
      .orderBy(ucRewardsRulesTable.id);
    res.json({ rules });
  } catch (err) {
    console.error("[uc/admin/rewards/rules] list error:", err);
    res.status(500).json({ error: "Failed to fetch reward rules" });
  }
});

// ─── Admin: PATCH /uc/admin/rewards/rules/:id ─────────────────────────────────

router.patch("/uc/admin/rewards/rules/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const rawId = req.params["id"];
  const id = parseInt(Array.isArray(rawId) ? rawId[0] ?? "" : rawId ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid rule id" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: { pointsValue?: number; active?: boolean; updatedBy?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (body["pointsValue"] !== undefined) {
    const v = Number(body["pointsValue"]);
    if (!Number.isInteger(v) || v < 0) {
      res.status(400).json({ error: "pointsValue must be a non-negative integer" });
      return;
    }
    updates.pointsValue = v;
  }

  if (body["active"] !== undefined) {
    if (typeof body["active"] !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }
    updates.active = body["active"];
  }

  if (typeof body["updatedBy"] === "string" && body["updatedBy"].trim()) {
    updates.updatedBy = body["updatedBy"].trim().slice(0, 255);
  }

  if (Object.keys(updates).length === 1) {
    // Only updatedAt — nothing to change
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  try {
    const [row] = await db
      .update(ucRewardsRulesTable)
      .set(updates)
      .where(eq(ucRewardsRulesTable.id, id))
      .returning();

    if (!row) { res.status(404).json({ error: "Rule not found" }); return; }
    res.json({ rule: row });
  } catch (err) {
    console.error("[uc/admin/rewards/rules] patch error:", err);
    res.status(500).json({ error: "Failed to update rule" });
  }
});

// ─── Admin: POST /uc/admin/rewards/grant ─────────────────────────────────────

/**
 * Resolve a customer account by phone, email, or QR payload string
 * ("uc-rewards:<id>:<phone>"). Returns null when no match is found.
 */
async function resolveCustomer(
  lookup: string
): Promise<{ id: number; email: string; firstName: string; phone: string } | null> {
  const trimmed = lookup.trim();
  if (!trimmed) return null;

  // QR code format: uc-rewards:<userId>:<phone>
  const qrMatch = trimmed.match(/^uc-rewards:(\d+):(.*)$/);
  if (qrMatch) {
    const id = parseInt(qrMatch[1]!, 10);
    const [row] = await db
      .select({ id: ucUsersTable.id, email: ucUsersTable.email, firstName: ucUsersTable.firstName, phone: ucUsersTable.phone })
      .from(ucUsersTable)
      .where(and(eq(ucUsersTable.id, id), isNull(ucUsersTable.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  // Email or phone lookup
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  if (isEmail) {
    const [row] = await db
      .select({ id: ucUsersTable.id, email: ucUsersTable.email, firstName: ucUsersTable.firstName, phone: ucUsersTable.phone })
      .from(ucUsersTable)
      .where(and(eq(ucUsersTable.email, trimmed.toLowerCase()), isNull(ucUsersTable.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  // Phone — strip spaces and try
  const [row] = await db
    .select({ id: ucUsersTable.id, email: ucUsersTable.email, firstName: ucUsersTable.firstName, phone: ucUsersTable.phone })
    .from(ucUsersTable)
    .where(and(eq(ucUsersTable.phone, trimmed), isNull(ucUsersTable.deletedAt)))
    .limit(1);
  return row ?? null;
}

router.post("/uc/admin/rewards/grant", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const body = req.body as Record<string, unknown>;
  const lookup  = typeof body["lookup"]  === "string" ? body["lookup"]  : "";
  const reason  = typeof body["reason"]  === "string" ? body["reason"].trim().slice(0, 500) : "";
  const grantedBy = typeof body["grantedBy"] === "string" ? body["grantedBy"].trim().slice(0, 255) : "";

  const points = Number(body["points"]);
  if (!Number.isInteger(points) || points <= 0) {
    res.status(400).json({ error: "points must be a positive integer" });
    return;
  }
  if (!lookup.trim()) {
    res.status(400).json({ error: "lookup (phone, email, or QR string) is required" });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  try {
    const customer = await resolveCustomer(lookup);
    if (!customer) {
      res.status(404).json({ error: "No active account found for this phone, email, or QR code" });
      return;
    }

    const [entry] = await db
      .insert(ucRewardsLedgerTable)
      .values({
        userId:    customer.id,
        points,
        reason,
        eventType: "manual",
        grantedBy: grantedBy || null,
      })
      .returning();

    // Return updated balance
    const [balanceRow] = await db
      .select({ balance: sql<number>`COALESCE(SUM(${ucRewardsLedgerTable.points}), 0)` })
      .from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, customer.id));

    const newBalance = Number(balanceRow?.balance ?? 0);

    // Notify the customer in-app about their manually granted points.
    // Fire-and-forget: sendPushToUser never throws and respects opt-out prefs.
    sendPushToUser(
      String(customer.id),
      "Points earned",
      `🌟 You earned ${points} points! ${reason}. Your balance is now ${newBalance} pts.`,
      { screen: "rewards" },
      "orders"
    );

    res.status(201).json({
      entry,
      customer: { id: customer.id, email: customer.email, firstName: customer.firstName, phone: customer.phone },
      newBalance,
    });
  } catch (err) {
    console.error("[uc/admin/rewards/grant] error:", err);
    res.status(500).json({ error: "Failed to grant points" });
  }
});

// ─── Admin: GET /uc/admin/rewards/balances ───────────────────────────────────
//
// Returns ALL active customers with their running balance (COALESCE to 0 for
// those with no ledger entries yet), sorted descending by balance.
// Optional ?search= filters by name or email (case-insensitive).

router.get("/uc/admin/rewards/balances", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";

  try {
    // Start from uc_users so customers with zero ledger entries are included.
    // LEFT JOIN the ledger and GROUP BY user so we can SUM(points) per customer.
    const balanceCol = sql<number>`COALESCE(SUM(${ucRewardsLedgerTable.points}), 0)`;

    const whereClause = search
      ? and(
          isNull(ucUsersTable.deletedAt),
          or(
            ilike(ucUsersTable.email, `%${search}%`),
            ilike(ucUsersTable.firstName, `%${search}%`),
            ilike(ucUsersTable.lastName, `%${search}%`),
          ),
        )
      : isNull(ucUsersTable.deletedAt);

    const rows = await db
      .select({
        userId:    ucUsersTable.id,
        email:     ucUsersTable.email,
        firstName: ucUsersTable.firstName,
        lastName:  ucUsersTable.lastName,
        phone:     ucUsersTable.phone,
        balance:   balanceCol,
      })
      .from(ucUsersTable)
      .leftJoin(ucRewardsLedgerTable, eq(ucRewardsLedgerTable.userId, ucUsersTable.id))
      .where(whereClause)
      .groupBy(
        ucUsersTable.id,
        ucUsersTable.email,
        ucUsersTable.firstName,
        ucUsersTable.lastName,
        ucUsersTable.phone,
      )
      .orderBy(desc(balanceCol));

    res.json({ customers: rows });
  } catch (err) {
    console.error("[uc/admin/rewards/balances] error:", err);
    res.status(500).json({ error: "Failed to fetch balances" });
  }
});

// ─── Admin: GET /uc/admin/rewards/ledger ─────────────────────────────────────
//
// Returns ledger entries joined with user info.
// Optional query params:
//   ?userId=<id>   — filter to a single customer
//   ?export=1      — returns CSV instead of JSON

router.get("/uc/admin/rewards/ledger", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const rawUserId = req.query["userId"];
  const userId = rawUserId ? parseInt(String(rawUserId), 10) : null;
  const wantCsv = req.query["export"] === "1";

  if (rawUserId && (userId === null || isNaN(userId))) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  try {
    const rows = await db
      .select({
        id:        ucRewardsLedgerTable.id,
        userId:    ucRewardsLedgerTable.userId,
        email:     ucUsersTable.email,
        firstName: ucUsersTable.firstName,
        lastName:  ucUsersTable.lastName,
        points:    ucRewardsLedgerTable.points,
        reason:    ucRewardsLedgerTable.reason,
        eventType: ucRewardsLedgerTable.eventType,
        grantedBy: ucRewardsLedgerTable.grantedBy,
        createdAt: ucRewardsLedgerTable.createdAt,
      })
      .from(ucRewardsLedgerTable)
      .innerJoin(ucUsersTable, eq(ucUsersTable.id, ucRewardsLedgerTable.userId))
      .where(userId ? eq(ucRewardsLedgerTable.userId, userId) : undefined)
      .orderBy(desc(ucRewardsLedgerTable.createdAt));

    if (wantCsv) {
      const header = "id,userId,email,firstName,lastName,points,reason,eventType,grantedBy,date";
      const escape = (v: unknown) => {
        let s = v == null ? "" : String(v);
        // Neutralize spreadsheet formula injection: prefix cells that begin
        // with a formula-trigger character so they are treated as plain text.
        if (s.length > 0 && (s[0] === "=" || s[0] === "+" || s[0] === "-" || s[0] === "@")) {
          s = `'${s}`;
        }
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const lines = rows.map((r) =>
        [
          r.id,
          r.userId,
          escape(r.email),
          escape(r.firstName),
          escape(r.lastName),
          r.points,
          escape(r.reason),
          escape(r.eventType),
          escape(r.grantedBy ?? ""),
          new Date(r.createdAt).toISOString(),
        ].join(",")
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rewards-ledger${userId ? `-user${userId}` : ""}.csv"`,
      );
      res.send([header, ...lines].join("\n"));
      return;
    }

    res.json({ ledger: rows });
  } catch (err) {
    console.error("[uc/admin/rewards/ledger] error:", err);
    res.status(500).json({ error: "Failed to fetch ledger" });
  }
});

export default router;
