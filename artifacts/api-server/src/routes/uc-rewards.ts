/**
 * UC Rewards — admin rules panel + customer balance endpoint.
 *
 * Admin routes (Bearer token — team admin or UC admin):
 *   GET    /uc/admin/rewards/rules               — list all reward rules
 *   PATCH  /uc/admin/rewards/rules/:id           — update pointsValue or active
 *   POST   /uc/admin/rewards/grant               — manually award points to a user
 *   GET    /uc/admin/rewards/balances            — customer balances, sorted desc, optional ?search=
 *   GET    /uc/admin/rewards/ledger              — ledger, optional ?userId=&from=&to=&eventType=&export=1
 *
 * Customer route (Bearer token — any authenticated UC user):
 *   GET    /uc/customer/rewards          — returns spendable balance, lifetime redeemed, and last 20 ledger entries
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, pool, ucNotificationLogTable, ucRewardsRulesTable, ucRewardsLedgerTable,
  ucUsersTable, ucRewardConversionTable, teamUsersTable,
} from "@workspace/db";
import { eq, desc, sql, or, and, isNull, ilike, gte, lte, lt } from "drizzle-orm";
import { requireAdmin, adminEmailList } from "../lib/adminAuth.js";
import { verifyToken } from "../lib/jwt.js";
import { sendRewardPushNotification } from "../lib/push.js";
import { normalizeEmail, normalizePhone } from "../lib/customer-identity.js";
import { consumePromotionOnClient, quotePromotion } from "../lib/reward-promotions.js";
import { serverPricedLines } from "./uc.js";

const router: IRouter = Router();

const QR_PREFIX = "uc-rewards:v1:";

/** Resolve the authenticated administrator again; never accept an actor in JSON. */
async function adminActor(req: Request): Promise<string> {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) return "admin:unknown";
  if (claims.type === "team-session" && typeof claims.id === "string") {
    const [team] = await db.select({ email: teamUsersTable.email }).from(teamUsersTable)
      .where(eq(teamUsersTable.id, claims.id)).limit(1);
    return team?.email ?? `team:${claims.id}`;
  }
  const id = Number(claims.id);
  if (Number.isInteger(id) && id > 0 && id < 1_000_000_000) {
    const [user] = await db.select({ email: ucUsersTable.email }).from(ucUsersTable)
      .where(eq(ucUsersTable.id, id)).limit(1);
    return user?.email ?? `user:${id}`;
  }
  return typeof claims.email === "string" ? claims.email.toLowerCase() : "admin:unknown";
}

async function isPrimaryAdmin(req: Request): Promise<boolean> {
  const primary = (process.env["PROJECTHUB_ADMIN_EMAIL"] ?? adminEmailList()[0] ?? "").trim().toLowerCase();
  return !!primary && (await adminActor(req)).toLowerCase() === primary;
}

function hashQrToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newQrToken(): string {
  return randomBytes(32).toString("base64url");
}

function starLevel(litres: number): number {
  if (litres >= 5000) return 5;
  if (litres >= 1000) return 4;
  if (litres >= 500) return 3;
  if (litres >= 100) return 2;
  return 1;
}

async function personalImpact(userId: number) {
  const result = await pool.query<{
    id: number; product_id: number; product_name: string; rated_capacity_litres: number;
    activated_at: Date; source_order_id: number | null; used_litres: string;
  }>(`
    SELECT rf.id, rf.product_id, rf.product_name, rf.rated_capacity_litres,
           rf.activated_at, rf.source_order_id,
           COALESCE(SUM(w.litres), 0)::text AS used_litres
    FROM uc_registered_filters rf
    LEFT JOIN uc_water_impact_ledger w ON w.registered_filter_id = rf.id
    WHERE rf.user_id = $1 AND rf.active = true
    GROUP BY rf.id
    ORDER BY rf.created_at DESC
  `, [userId]);
  const filters = result.rows.map((row) => {
    const usedLitres = Number(row.used_litres);
    return {
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      ratedCapacityLitres: row.rated_capacity_litres,
      usedLitres,
      remainingCapacityLitres: Math.max(0, row.rated_capacity_litres - usedLitres),
      activatedAt: row.activated_at,
      sourceOrderId: row.source_order_id,
    };
  });
  const history = await pool.query<{
    id: number; registered_filter_id: number; product_name: string; litres: number;
    reason: string; actor: string; created_at: Date;
  }>(`
    SELECT w.id, w.registered_filter_id, rf.product_name, w.litres,
           w.reason, w.actor, w.created_at
    FROM uc_water_impact_ledger w
    JOIN uc_registered_filters rf ON rf.id = w.registered_filter_id
    WHERE w.user_id = $1
    ORDER BY w.created_at DESC
    LIMIT 20
  `, [userId]);
  // Ledger totals deliberately include retired filters: they are actual
  // refills, unlike the theoretical capacity of currently active purchases.
  const totalResult = await pool.query<{ total_litres: string }>(
    `SELECT COALESCE(SUM(litres), 0)::text AS total_litres
     FROM uc_water_impact_ledger WHERE user_id = $1`,
    [userId],
  );
  const totalLitres = Number(totalResult.rows[0]?.total_litres ?? 0);
  return {
    totalLitres,
    starLevel: starLevel(totalLitres),
    hasRefilled: history.rows.length > 0,
    remainingCapacityLitres: filters.reduce((sum, filter) => sum + filter.remainingCapacityLitres, 0),
    filters,
    history: history.rows.map((row) => ({
      id: row.id,
      registeredFilterId: row.registered_filter_id,
      productName: row.product_name,
      litres: row.litres,
      reason: row.reason,
      actor: row.actor,
      createdAt: row.created_at,
    })),
  };
}

async function authenticatedCustomer(req: Request, res: Response): Promise<number | null> {
  const claims = verifyToken(req.headers["authorization"]);
  const userId = claims ? Number(claims.id) : 0;
  if (!Number.isInteger(userId) || userId <= 0 || userId >= 1_000_000_000) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const [user] = await db.select({ id: ucUsersTable.id }).from(ucUsersTable)
    .where(and(eq(ucUsersTable.id, userId), isNull(ucUsersTable.deletedAt))).limit(1);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}

// ─── Customer: GET /uc/customer/rewards ───────────────────────────────────────

router.get("/uc/customer/rewards", async (req: Request, res: Response): Promise<void> => {
  const userId = await authenticatedCustomer(req, res);
  if (!userId) return;

  try {
    const [balanceRow] = await db
      .select({
        balance: sql<number>`COALESCE(SUM(${ucRewardsLedgerTable.points}), 0)`,
        lifetimeRedeemed: sql<number>`COALESCE(SUM(-${ucRewardsLedgerTable.points}) FILTER (WHERE ${ucRewardsLedgerTable.eventType} = 'redemption'), 0)`,
      })
      .from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, userId));

    const ledger = await db
      .select()
      .from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, userId))
      .orderBy(desc(ucRewardsLedgerTable.createdAt))
      .limit(20);

    const [user] = await db.select({
      rewardsQrHash: ucUsersTable.rewardsQrHash,
      rewardsQrRevokedAt: ucUsersTable.rewardsQrRevokedAt,
    }).from(ucUsersTable).where(eq(ucUsersTable.id, userId)).limit(1);
    let qrToken: string | null = null;
    if (!user?.rewardsQrHash || user.rewardsQrRevokedAt) {
      const token = newQrToken();
      await db.update(ucUsersTable).set({
        rewardsQrHash: hashQrToken(token),
        rewardsQrRevokedAt: null,
      }).where(eq(ucUsersTable.id, userId));
      qrToken = token;
    }
    res.json({
      balance: Number(balanceRow?.balance ?? 0),
      lifetimeRedeemed: Number(balanceRow?.lifetimeRedeemed ?? 0),
      ledger,
      qrToken,
      impact: await personalImpact(userId),
    });
  } catch (err) {
    console.error("[uc/customer/rewards] error:", err);
    res.status(500).json({ error: "Failed to fetch rewards" });
  }
});

router.post("/uc/customer/rewards/qr/rotate", async (req: Request, res: Response): Promise<void> => {
  const userId = await authenticatedCustomer(req, res);
  if (!userId) return;
  const token = newQrToken();
  await db.update(ucUsersTable).set({
    rewardsQrHash: hashQrToken(token),
    rewardsQrRevokedAt: null,
  }).where(eq(ucUsersTable.id, userId));
  res.json({ qrToken: token });
});

router.get("/uc/customer/impact", async (req: Request, res: Response): Promise<void> => {
  const userId = await authenticatedCustomer(req, res);
  if (!userId) return;
  try {
    res.json(await personalImpact(userId));
  } catch (err) {
    console.error("[uc/customer/impact] error:", err);
    res.status(500).json({ error: "Failed to fetch personal impact" });
  }
});

async function addWaterEntry(input: {
  userId: number;
  registeredFilterId: number;
  litres: number;
  reason: string;
  actor: string;
  idempotencyKey: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [input.registeredFilterId]);
    // Serialize retries by user/key as well as writes against this filter.
    // This prevents a duplicate key sent concurrently with a changed filter
    // selection from reaching the unique index as an unhandled conflict.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      String(input.userId), input.idempotencyKey,
    ]);
    const existing = await client.query(
      `SELECT id FROM uc_water_impact_ledger WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.userId, input.idempotencyKey],
    );
    if (existing.rows.length > 0) {
      await client.query("COMMIT");
      return { repeated: true, entryId: Number(existing.rows[0].id) };
    }
    const filterResult = await client.query(
      `SELECT id, rated_capacity_litres FROM uc_registered_filters
       WHERE id = $1 AND user_id = $2 AND active = true FOR UPDATE`,
      [input.registeredFilterId, input.userId],
    );
    if (filterResult.rows.length === 0) {
      const error = new Error("Registered filter not found") as Error & { code?: string };
      error.code = "FILTER_NOT_FOUND";
      throw error;
    }
    const usedResult = await client.query(
      `SELECT COALESCE(SUM(litres), 0)::integer AS used FROM uc_water_impact_ledger
       WHERE registered_filter_id = $1`,
      [input.registeredFilterId],
    );
    const used = Number(usedResult.rows[0]?.used ?? 0);
    const capacity = Number(filterResult.rows[0].rated_capacity_litres);
    // Negative entries are explicit compensating corrections. They restore
    // capacity; only a positive contribution can consume it.
    if (input.litres > 0 && input.litres > capacity - used) {
      const remaining = Math.max(0, capacity - used);
      const error = new Error(
        remaining === 0
          ? "This filter has reached its rated capacity. A replacement is required before recording more litres."
          : `This refill exceeds the ${remaining} L remaining rated capacity. Record no more than ${remaining} L or replace the filter first.`,
      ) as Error & { code?: string; remaining?: number };
      error.code = "CAPACITY_EXCEEDED";
      error.remaining = remaining;
      throw error;
    }
    if (input.litres < 0 && used + input.litres < 0) {
      const error = new Error("Correction cannot reduce recorded litres below zero") as Error & { code?: string };
      error.code = "INVALID_CORRECTION";
      throw error;
    }
    const inserted = await client.query(
      `INSERT INTO uc_water_impact_ledger
       (user_id, registered_filter_id, litres, reason, actor, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.userId, input.registeredFilterId, input.litres, input.reason, input.actor, input.idempotencyKey],
    );
    await client.query("COMMIT");
    return { repeated: false, entryId: Number(inserted.rows[0].id) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

router.post("/uc/customer/impact", async (req: Request, res: Response): Promise<void> => {
  const userId = await authenticatedCustomer(req, res);
  if (!userId) return;
  const registeredFilterId = Number(req.body?.registeredFilterId);
  const litres = Number(req.body?.litres);
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
    ? req.body.reason.trim().slice(0, 500)
    : "Customer refilled water";
  const idempotencyKey = typeof req.body?.idempotencyKey === "string"
    ? req.body.idempotencyKey.trim().slice(0, 200)
    : "";
  if (!Number.isInteger(registeredFilterId) || registeredFilterId <= 0 ||
      !Number.isInteger(litres) || litres <= 0 || !idempotencyKey) {
    res.status(400).json({ error: "registeredFilterId, positive whole litres, and idempotencyKey are required" });
    return;
  }
  try {
    const result = await addWaterEntry({
      userId, registeredFilterId, litres, reason, actor: `customer:${userId}`, idempotencyKey,
    });
    res.status(result.repeated ? 200 : 201).json({ ...result, impact: await personalImpact(userId) });
  } catch (err) {
    const typed = err as Error & { code?: string; remaining?: number };
    if (typed.code === "FILTER_NOT_FOUND") {
      res.status(404).json({ error: typed.message });
    } else if (typed.code === "CAPACITY_EXCEEDED") {
      res.status(409).json({ error: typed.message, remainingCapacityLitres: typed.remaining });
    } else if (typed.code === "INVALID_CORRECTION") {
      res.status(409).json({ error: typed.message });
    } else {
      console.error("[uc/customer/impact] add error:", err);
      res.status(500).json({ error: "Failed to record litres" });
    }
  }
});

router.post("/uc/admin/rewards/impact", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const lookup = typeof req.body?.lookup === "string" ? req.body.lookup : "";
  const registeredFilterId = Number(req.body?.registeredFilterId);
  const litres = Number(req.body?.litres);
  const correction = req.body?.correction === true;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim().slice(0, 200) : "";
  if (!lookup.trim() || !Number.isInteger(registeredFilterId) || registeredFilterId <= 0 ||
      !Number.isInteger(litres) || litres === 0 || !reason || !idempotencyKey ||
      (litres < 0 && !correction)) {
    res.status(400).json({ error: "lookup, registeredFilterId, non-zero whole litres, reason, and idempotencyKey are required; negative litres require correction=true" });
    return;
  }
  const customer = await resolveCustomer(lookup);
  if (!customer) { res.status(404).json({ error: "No active account found for this lookup" }); return; }
  try {
    const result = await addWaterEntry({
      userId: customer.id, registeredFilterId, litres, reason,
      actor: await adminActor(req), idempotencyKey,
    });
    res.status(result.repeated ? 200 : 201).json({ ...result, impact: await personalImpact(customer.id) });
  } catch (err) {
    const typed = err as Error & { code?: string; remaining?: number };
    if (typed.code === "FILTER_NOT_FOUND") res.status(404).json({ error: typed.message });
    else if (typed.code === "CAPACITY_EXCEEDED") res.status(409).json({ error: typed.message, remainingCapacityLitres: typed.remaining });
    else if (typed.code === "INVALID_CORRECTION") res.status(409).json({ error: typed.message });
    else { console.error("[uc/admin/rewards/impact] error:", err); res.status(500).json({ error: "Failed to record litres" }); }
  }
});

/** Staff-only Companion-wide impact view. Totals and customer detail are read
 * directly from the same append-only ledger used by personal impact. */
router.get("/uc/admin/rewards/impact", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  const term = `%${search}%`;
  try {
    const [overall, count, customers] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(litres),0)::integer AS total_litres FROM uc_water_impact_ledger`),
      pool.query(`SELECT count(*)::integer AS count FROM (
        SELECT u.id FROM uc_users u LEFT JOIN uc_water_impact_ledger w ON w.user_id=u.id
        WHERE u.deleted_at IS NULL AND ($1='' OR u.email ILIKE $2 OR u.first_name ILIKE $2 OR u.last_name ILIKE $2)
        GROUP BY u.id
      ) x`, [search, term]),
      pool.query(`SELECT u.id,u.email,u.first_name,u.last_name,COALESCE(SUM(w.litres),0)::integer AS total_litres,
          COALESCE(count(w.id),0)::integer AS entry_count
        FROM uc_users u LEFT JOIN uc_water_impact_ledger w ON w.user_id=u.id
        WHERE u.deleted_at IS NULL AND ($1='' OR u.email ILIKE $2 OR u.first_name ILIKE $2 OR u.last_name ILIKE $2)
        GROUP BY u.id
        ORDER BY total_litres DESC, u.id ASC LIMIT $3 OFFSET $4`, [search, term, pageSize, (page - 1) * pageSize]),
    ]);
    res.json({ overallTotalLitres: Number(overall.rows[0]?.total_litres ?? 0), page, pageSize,
      totalCustomers: Number(count.rows[0]?.count ?? 0), customers: customers.rows });
  } catch (error) {
    console.error("[uc/admin/rewards/impact] aggregate error:", error);
    res.status(500).json({ error: "Failed to fetch impact aggregation" });
  }
});

router.get("/uc/admin/rewards/impact/:userId", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { res.status(400).json({ error: "Invalid userId" }); return; }
  const [user] = await db.select({ id: ucUsersTable.id, email: ucUsersTable.email, firstName: ucUsersTable.firstName, lastName: ucUsersTable.lastName })
    .from(ucUsersTable).where(and(eq(ucUsersTable.id, userId), isNull(ucUsersTable.deletedAt))).limit(1);
  if (!user) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json({ customer: user, impact: await personalImpact(userId) });
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

async function resolveCustomer(
  lookup: string
): Promise<{ id: number; email: string; firstName: string; phone: string } | null> {
  const trimmed = lookup.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(QR_PREFIX)) {
    const token = trimmed.slice(QR_PREFIX.length);
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
    const [row] = await db
      .select({ id: ucUsersTable.id, email: ucUsersTable.email, firstName: ucUsersTable.firstName, phone: ucUsersTable.phone })
      .from(ucUsersTable)
      .where(and(
        eq(ucUsersTable.rewardsQrHash, hashQrToken(token)),
        isNull(ucUsersTable.rewardsQrRevokedAt),
        isNull(ucUsersTable.deletedAt),
      ))
      .limit(1);
    return row ?? null;
  }

  // Email or phone lookup
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  if (isEmail) {
    const [row] = await db
      .select({ id: ucUsersTable.id, email: ucUsersTable.email, firstName: ucUsersTable.firstName, phone: ucUsersTable.phone })
      .from(ucUsersTable)
      .where(and(eq(ucUsersTable.email, normalizeEmail(trimmed)), isNull(ucUsersTable.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  // Phone — use the same canonical identity format as registration.
  const phone = normalizePhone(trimmed);
  if (!phone) return null;
  const [row] = await db
    .select({ id: ucUsersTable.id, email: ucUsersTable.email, firstName: ucUsersTable.firstName, phone: ucUsersTable.phone })
    .from(ucUsersTable)
    .where(and(eq(ucUsersTable.phone, phone), isNull(ucUsersTable.deletedAt)))
    .limit(1);
  return row ?? null;
}

function maskedCustomer(customer: NonNullable<Awaited<ReturnType<typeof resolveCustomer>>>) {
  const phone = customer.phone ?? "";
  const [local = "", domain = ""] = (customer.email ?? "").split("@");
  return {
    id: customer.id,
    firstName: customer.firstName,
    phone: phone.length > 4 ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}` : phone,
    email: domain ? `${local.slice(0, 2)}***@${domain}` : "",
  };
}

router.post("/uc/admin/rewards/resolve", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const lookup = typeof req.body?.lookup === "string" ? req.body.lookup : "";
  if (!lookup.trim()) {
    res.status(400).json({ error: "QR value, phone, email, or customer code is required" });
    return;
  }
  const customer = await resolveCustomer(lookup);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  const [balanceRow] = await db.select({
    balance: sql<number>`coalesce(sum(${ucRewardsLedgerTable.points}), 0)`,
    lifetimeRedeemed: sql<number>`COALESCE(SUM(-${ucRewardsLedgerTable.points}) FILTER (WHERE ${ucRewardsLedgerTable.eventType} = 'redemption'), 0)`,
  }).from(ucRewardsLedgerTable).where(eq(ucRewardsLedgerTable.userId, customer.id));
  res.json({
    customer: maskedCustomer(customer),
    balance: Number(balanceRow?.balance ?? 0),
    lifetimeRedeemed: Number(balanceRow?.lifetimeRedeemed ?? 0),
    impact: await personalImpact(customer.id),
  });
});

router.post("/uc/admin/rewards/qr/revoke", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const lookup = typeof req.body?.lookup === "string" ? req.body.lookup : "";
  const customer = await resolveCustomer(lookup);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  await db.update(ucUsersTable).set({ rewardsQrRevokedAt: new Date() })
    .where(eq(ucUsersTable.id, customer.id));
  res.json({ revoked: true, customer: maskedCustomer(customer) });
});

router.get("/uc/admin/rewards/conversion", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const [conversion] = await db.select().from(ucRewardConversionTable)
    .where(eq(ucRewardConversionTable.id, "singleton")).limit(1);
  // Keep PATCH and GET permission semantics identical; the UI receives a
  // server-derived capability, never a JWT/client role assertion.
  res.json({ conversion: conversion ?? { id: "singleton", mode: "kes", value: "100", active: true }, canEdit: await isPrimaryAdmin(req) });
});

router.patch("/uc/admin/rewards/conversion", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  if (!(await isPrimaryAdmin(req))) {
    res.status(403).json({ error: "Only the configured primary admin may change redemption conversion" });
    return;
  }
  const mode = req.body?.mode;
  const value = Number(req.body?.value);
  const active = req.body?.active;
  if ((mode !== "kes" && mode !== "percentage") || !Number.isFinite(value) || value < 0 ||
      (active !== undefined && typeof active !== "boolean")) {
    res.status(400).json({ error: "mode (kes or percentage), a non-negative value, and optional active boolean are required" });
    return;
  }
  const actor = await adminActor(req);
  const [conversion] = await db.insert(ucRewardConversionTable).values({
    id: "singleton", mode, value: String(value), active: active ?? true, updatedBy: actor, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: ucRewardConversionTable.id,
    set: { mode, value: String(value), active: active ?? true, updatedBy: actor, updatedAt: new Date() },
  }).returning();
  res.json({ conversion });
});

function promotionPayload(body: Record<string, unknown>) {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const type = body.type;
  const effectMode = body.effectMode;
  const effectValue = Number(body.effectValue);
  const startsAt = new Date(String(body.startsAt ?? ""));
  const endsAt = body.endsAt == null || body.endsAt === "" ? null : new Date(String(body.endsAt));
  const eligibleProductIds = Array.isArray(body.eligibleProductIds) ? body.eligibleProductIds.map(Number) : [];
  const globalUseLimit = body.globalUseLimit == null || body.globalUseLimit === "" ? null : Number(body.globalUseLimit);
  const perUserUseLimit = body.perUserUseLimit == null || body.perUserUseLimit === "" ? null : Number(body.perUserUseLimit);
  if (!/^[A-Z0-9_-]{3,64}$/.test(code) || !["bonus_points","redemption_boost","checkout_discount"].includes(String(type)) ||
      !["fixed","percentage"].includes(String(effectMode)) || !Number.isFinite(effectValue) || effectValue <= 0 ||
      (effectMode === "percentage" && effectValue > 100) || isNaN(startsAt.getTime()) ||
      (endsAt && (isNaN(endsAt.getTime()) || endsAt <= startsAt)) || eligibleProductIds.some((id) => !Number.isInteger(id) || id <= 0) ||
      [globalUseLimit, perUserUseLimit].some((n) => n !== null && (!Number.isInteger(n) || n <= 0))) return null;
  return { code, type: String(type), effectMode: String(effectMode), effectValue, startsAt, endsAt, eligibleProductIds: [...new Set(eligibleProductIds)], globalUseLimit, perUserUseLimit };
}

router.get("/uc/admin/promotions", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await pool.query(`SELECT p.*, COALESCE(uses.use_count,0)::int AS use_count, COALESCE(products.eligible_product_ids,'{}') AS eligible_product_ids FROM uc_promotions p LEFT JOIN (SELECT promotion_id,count(*) AS use_count FROM uc_promotion_uses GROUP BY promotion_id) uses ON uses.promotion_id=p.id LEFT JOIN (SELECT promotion_id,array_agg(product_id) AS eligible_product_ids FROM uc_promotion_products GROUP BY promotion_id) products ON products.promotion_id=p.id ORDER BY p.created_at DESC`);
  res.json({ promotions: rows.rows });
});
router.post("/uc/admin/promotions", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const data = promotionPayload(req.body ?? {}); if (!data) { res.status(400).json({ error: "Invalid promotion" }); return; }
  const actor = await adminActor(req); const client = await pool.connect();
  try { await client.query("BEGIN");
    const r = await client.query(`INSERT INTO uc_promotions (code,type,effect_mode,effect_value,starts_at,ends_at,global_use_limit,per_user_use_limit,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`, [data.code,data.type,data.effectMode,data.effectValue,data.startsAt,data.endsAt,data.globalUseLimit,data.perUserUseLimit,actor]);
    for (const productId of data.eligibleProductIds) await client.query(`INSERT INTO uc_promotion_products (promotion_id,product_id) VALUES ($1,$2)`, [r.rows[0].id,productId]);
    await client.query("COMMIT"); res.status(201).json({ promotion: r.rows[0] });
  } catch (e) { await client.query("ROLLBACK"); res.status(409).json({ error: "Promotion code already exists" }); } finally { client.release(); }
});
router.patch("/uc/admin/promotions/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id); const data = promotionPayload(req.body ?? {}); if (!Number.isInteger(id) || !data) { res.status(400).json({ error: "Invalid promotion" }); return; }
  const client = await pool.connect(); try { await client.query("BEGIN");
    const r = await client.query(`UPDATE uc_promotions SET code=$2,type=$3,effect_mode=$4,effect_value=$5,starts_at=$6,ends_at=$7,global_use_limit=$8,per_user_use_limit=$9,updated_by=$10,updated_at=now() WHERE id=$1 RETURNING *`, [id,data.code,data.type,data.effectMode,data.effectValue,data.startsAt,data.endsAt,data.globalUseLimit,data.perUserUseLimit,await adminActor(req)]);
    if (!r.rows[0]) { await client.query("ROLLBACK"); res.status(404).json({ error: "Promotion not found" }); return; }
    await client.query(`DELETE FROM uc_promotion_products WHERE promotion_id=$1`,[id]); for (const productId of data.eligibleProductIds) await client.query(`INSERT INTO uc_promotion_products (promotion_id,product_id) VALUES ($1,$2)`,[id,productId]);
    await client.query("COMMIT"); res.json({ promotion:r.rows[0] });
  } catch { await client.query("ROLLBACK"); res.status(409).json({error:"Promotion code already exists"}); } finally { client.release(); }
});
router.post("/uc/admin/promotions/:id/:state", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req,res))) return; const id=Number(req.params.id); const state = req.params.state; if (state !== "activate" && state !== "deactivate") { res.status(404).json({ error: "Unknown promotion action" }); return; } const active=state==="activate";
  const r=await pool.query(`UPDATE uc_promotions SET active=$2,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *`,[id,active,await adminActor(req)]);
  if (!r.rows[0]) {res.status(404).json({error:"Promotion not found"});return;} res.json({promotion:r.rows[0]});
});
router.get("/uc/admin/promotions/:id/usage", async (req,res): Promise<void> => {
  if (!(await requireAdmin(req,res))) return; const id=Number(req.params.id);
  const r=await pool.query(`SELECT operation,count(*)::int AS uses,COALESCE(sum(benefit_amount),0)::text AS benefit FROM uc_promotion_uses WHERE promotion_id=$1 GROUP BY operation`,[id]); res.json({promotionId:id,usage:r.rows});
});

router.post("/uc/customer/promotions/:operation/quote", async (req,res): Promise<void> => {
  const userId=await authenticatedCustomer(req,res); if(!userId)return;
  const op=req.params.operation; if(op!=="checkout"&&op!=="redemption"&&op!=="award"){res.status(400).json({error:"Invalid promotion operation"});return;}
  const lines = op === "checkout" ? serverPricedLines(req.body?.lineItems) : null;
  if (op === "checkout" && !lines) { res.status(400).json({ error: "checkout quotes require known lineItems with positive whole quantities" }); return; }
  const subtotal = lines ? lines.reduce((sum, line) => sum + line.subtotal, 0) : Number(req.body?.subtotal ?? 0);
  const quote=await quotePromotion(String(req.body?.code??""),op,lines ? lines.map((line) => line.productId) : Array.isArray(req.body?.productIds)?req.body.productIds.map(Number):[],subtotal);
  if(!quote){res.status(422).json({error:"Promotion is invalid, inactive, ineligible, or expired"});return;}
  if (op === "checkout") { const delivery = 500; res.json({ promotion: quote, subtotal, delivery, discountAmount: Math.round(quote.benefit), total: Math.max(0, subtotal + delivery - Math.round(quote.benefit)) }); return; }
  res.json({promotion:quote});
});
// Promotion consumption is intentionally not exposed as a customer operation.
// Checkout, redemption and awards consume only inside their verified business
// transactions, so a capped promotion cannot be spent against an arbitrary
// client-supplied operation reference.
/** Atomic staff award/redeem, protected by a per-customer transaction lock. */
router.post("/uc/admin/rewards/transaction", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const lookup = typeof req.body?.lookup === "string" ? req.body.lookup : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim().slice(0, 200) : "";
  const direction = req.body?.direction;
  const amount = Number(req.body?.points);
  const promoCode = typeof req.body?.promoCode === "string" ? req.body.promoCode.trim() : "";
  if ((direction !== "award" && direction !== "redeem") || !Number.isInteger(amount) || amount <= 0 ||
      !reason || !idempotencyKey || !lookup.trim() || (direction === "redeem" && amount % 1000 !== 0)) {
    res.status(400).json({ error: "A direction, positive whole points, reason, lookup, and idempotencyKey are required; redemptions must be 1,000-point blocks" });
    return;
  }
  const customer = await resolveCustomer(lookup);
  if (!customer) { res.status(404).json({ error: "No active account found for this lookup" }); return; }
  const actor = await adminActor(req);
  const promotion = promoCode ? await quotePromotion(promoCode, direction === "redeem" ? "redemption" : "award", [], amount) : null;
  if (promoCode && !promotion) { res.status(422).json({ error: "Promotion is invalid, inactive, ineligible, expired, or does not apply to this transaction" }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [customer.id]);
    const refId = `staff:${idempotencyKey}`;
    const prior = await client.query(`SELECT * FROM uc_rewards_ledger WHERE user_id = $1 AND ref_id = $2`, [customer.id, refId]);
    if (prior.rows[0]) {
      const bal = await client.query(`SELECT COALESCE(SUM(points), 0)::integer AS balance, COALESCE(SUM(-points) FILTER (WHERE event_type = 'redemption'), 0)::integer AS lifetime_redeemed FROM uc_rewards_ledger WHERE user_id = $1`, [customer.id]);
      await client.query("COMMIT");
      res.json({ entry: prior.rows[0], newBalance: Number(bal.rows[0].balance), lifetimeRedeemed: Number(bal.rows[0].lifetime_redeemed), repeated: true });
      return;
    }
    let conversion: { mode: string; value: string; active: boolean } | null = null;
    if (direction === "redeem") {
      const conversionResult = await client.query(`SELECT mode, value::text, active FROM uc_reward_conversion WHERE id = 'singleton'`);
      conversion = conversionResult.rows[0] ?? null;
      if (!conversion?.active) { await client.query("ROLLBACK"); res.status(409).json({ error: "Redemptions are currently disabled" }); return; }
      const bal = await client.query(`SELECT COALESCE(SUM(points), 0)::integer AS balance FROM uc_rewards_ledger WHERE user_id = $1`, [customer.id]);
      if (Number(bal.rows[0].balance) < amount) {
        await client.query("ROLLBACK"); res.status(409).json({ error: "Insufficient rewards balance", balance: Number(bal.rows[0].balance), required: amount }); return;
      }
      if (promotion) {
        // A boost changes only this immutable redemption snapshot; the point
        // debit remains the requested 1,000-point blocks.
        const base = Number(conversion!.value);
        conversion!.value = String(promotion.effectMode === "percentage" ? base * (1 + promotion.effectValue / 100) : base + promotion.effectValue);
      }
    }
    const snapshot = conversion ? ` [${conversion.mode}:${conversion.value} per 1000 points]` : "";
    const inserted = await client.query(
      `INSERT INTO uc_rewards_ledger (user_id, points, reason, event_type, ref_id, granted_by, conversion_mode, conversion_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [customer.id, direction === "redeem" ? -amount : amount, `${reason}${snapshot}`, direction === "redeem" ? "redemption" : "manual", refId, actor, conversion?.mode ?? null, conversion?.value ?? null],
    );
    if (promotion) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [promotion.id]);
      const limits = await client.query(`SELECT global_use_limit,per_user_use_limit FROM uc_promotions WHERE id=$1 AND active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) FOR UPDATE`, [promotion.id]);
      const counts = await client.query(`SELECT count(*) FILTER (WHERE promotion_id=$1)::int AS global,count(*) FILTER (WHERE promotion_id=$1 AND user_id=$2)::int AS personal FROM uc_promotion_uses`, [promotion.id,customer.id]);
      if (!limits.rows[0] || (limits.rows[0].global_use_limit != null && Number(counts.rows[0].global) >= Number(limits.rows[0].global_use_limit)) || (limits.rows[0].per_user_use_limit != null && Number(counts.rows[0].personal) >= Number(limits.rows[0].per_user_use_limit))) { await client.query("ROLLBACK"); res.status(409).json({ error:"Promotion use limit reached" }); return; }
      const benefit = direction === "award" ? Math.max(1, Math.round(promotion.effectMode === "percentage" ? amount * promotion.effectValue / 100 : promotion.effectValue)) : promotion.benefit;
      await client.query(`INSERT INTO uc_promotion_uses (promotion_id,user_id,operation,operation_ref,actor,idempotency_key,effect_snapshot,benefit_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [promotion.id,customer.id,direction === "award" ? "award":"redemption",String(inserted.rows[0].id),actor,`staff-promo:${idempotencyKey}`,JSON.stringify({...promotion,benefit}),benefit]);
      if (direction === "award") await client.query(`INSERT INTO uc_rewards_ledger (user_id,points,reason,event_type,ref_id,granted_by) VALUES ($1,$2,$3,'promotion_bonus',$4,$5)`, [customer.id,benefit,`Promotion ${promotion.code} bonus`,`staff-bonus:${idempotencyKey}`,actor]);
    }
    const bal = await client.query(`SELECT COALESCE(SUM(points), 0)::integer AS balance, COALESCE(SUM(-points) FILTER (WHERE event_type = 'redemption'), 0)::integer AS lifetime_redeemed FROM uc_rewards_ledger WHERE user_id = $1`, [customer.id]);
    await client.query("COMMIT");
    const newBalance = Number(bal.rows[0].balance);
    const entry = inserted.rows[0];
    const notification = await sendRewardPushNotification({
      userId: customer.id, ledgerId: Number(entry.id),
      title: direction === "redeem" ? "Points redeemed" : "Points earned",
      body: direction === "redeem" ? `${amount} points redeemed. Balance: ${newBalance} pts.` : `You earned ${amount} points. Balance: ${newBalance} pts.`,
    });
    res.status(201).json({ entry, newBalance, lifetimeRedeemed: Number(bal.rows[0].lifetime_redeemed), repeated: false, conversion, notification });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[uc/admin/rewards/transaction] error:", err);
    res.status(500).json({ error: "Failed to record rewards transaction" });
  } finally { client.release(); }
});

/** Customer self-redemption; identity is exclusively the authenticated account. */
router.post("/uc/customer/rewards/redeem", async (req: Request, res: Response): Promise<void> => {
  const userId = await authenticatedCustomer(req, res); if (!userId) return;
  const points = Number(req.body?.points);
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim().slice(0, 200) : "";
  const promoCode = typeof req.body?.promoCode === "string" ? req.body.promoCode.trim() : "";
  if (!Number.isInteger(points) || points <= 0 || points % 1000 !== 0 || !idempotencyKey) {
    res.status(400).json({ error: "points must be positive whole 1,000-point blocks and idempotencyKey is required" }); return;
  }
  const promotion = promoCode ? await quotePromotion(promoCode, "redemption", [], points) : null;
  if (promoCode && !promotion) { res.status(422).json({ error: "Promotion is invalid, inactive, expired, or not a redemption boost" }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [userId]);
    const refId = `customer-redeem:${idempotencyKey}`;
    const prior = await client.query(`SELECT * FROM uc_rewards_ledger WHERE user_id=$1 AND ref_id=$2`, [userId, refId]);
    if (prior.rows[0]) {
       const balance = await client.query(`SELECT COALESCE(sum(points),0)::integer AS balance, COALESCE(SUM(-points) FILTER (WHERE event_type = 'redemption'), 0)::integer AS lifetime_redeemed FROM uc_rewards_ledger WHERE user_id=$1`, [userId]);
       await client.query("COMMIT"); res.json({ entry: prior.rows[0], newBalance: Number(balance.rows[0].balance), lifetimeRedeemed: Number(balance.rows[0].lifetime_redeemed), repeated: true }); return;
    }
    const conversionResult = await client.query(`SELECT mode,value::text,active FROM uc_reward_conversion WHERE id='singleton' FOR UPDATE`);
    const conversion = conversionResult.rows[0];
    if (!conversion?.active) { await client.query("ROLLBACK"); res.status(409).json({ error: "Redemptions are currently disabled" }); return; }
    const balance = await client.query(`SELECT COALESCE(sum(points),0)::integer AS balance FROM uc_rewards_ledger WHERE user_id=$1`, [userId]);
    if (Number(balance.rows[0].balance) < points) { await client.query("ROLLBACK"); res.status(409).json({ error: "Insufficient rewards balance", balance: Number(balance.rows[0].balance), required: points }); return; }
    let value = Number(conversion.value); let promoBenefit: number | null = null;
    if (promotion) { promoBenefit = promotion.effectMode === "percentage" ? value * promotion.effectValue / 100 : promotion.effectValue; value += promoBenefit; }
    const actor = `customer:${userId}`;
    const entry = await client.query(`INSERT INTO uc_rewards_ledger (user_id,points,reason,event_type,ref_id,granted_by,conversion_mode,conversion_value) VALUES ($1,$2,$3,'redemption',$4,$5,$6,$7) RETURNING *`, [userId,-points,`Customer redemption${promotion ? ` [promotion:${promotion.code}]` : ""}`,refId,actor,conversion.mode,String(value)]);
    if (promotion) await consumePromotionOnClient(client, { quote: { ...promotion, benefit: promoBenefit! }, userId, operation: "redemption", actor, idempotencyKey: `customer-redeem-promo:${idempotencyKey}`, operationRef: String(entry.rows[0].id) });
    const newBalance = await client.query(`SELECT COALESCE(sum(points),0)::integer AS balance, COALESCE(SUM(-points) FILTER (WHERE event_type = 'redemption'), 0)::integer AS lifetime_redeemed FROM uc_rewards_ledger WHERE user_id=$1`, [userId]);
    await client.query("COMMIT");
    res.status(201).json({ entry: entry.rows[0], newBalance: Number(newBalance.rows[0].balance), lifetimeRedeemed: Number(newBalance.rows[0].lifetime_redeemed), repeated: false, conversion: { mode: conversion.mode, value: String(value), active: true }, promotion: promotion ? { code: promotion.code, benefit: promoBenefit, effectValue: promotion.effectValue } : null });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined); const typed = error as Error & { code?: string };
    res.status(typed.code === "PROMOTION_EXHAUSTED" ? 409 : 500).json({ error: typed.message || "Failed to redeem rewards" });
  } finally { client.release(); }
});

router.post("/uc/admin/rewards/grant", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const body = req.body as Record<string, unknown>;
  const lookup  = typeof body["lookup"]  === "string" ? body["lookup"]  : "";
  const reason  = typeof body["reason"]  === "string" ? body["reason"].trim().slice(0, 500) : "";

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
        grantedBy: await adminActor(req),
      })
      .returning();

    // Return updated balance
    const [balanceRow] = await db
      .select({ balance: sql<number>`COALESCE(SUM(${ucRewardsLedgerTable.points}), 0)` })
      .from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, customer.id));

    const newBalance = Number(balanceRow?.balance ?? 0);

    const notification = await sendRewardPushNotification({
      userId: customer.id,
      ledgerId: entry!.id,
      title: "Points earned",
      body: `🌟 You earned ${points} points! ${reason}. Your balance is now ${newBalance} pts.`,
    });

    res.status(201).json({
      entry,
      customer: { id: customer.id, email: customer.email, firstName: customer.firstName, phone: customer.phone },
      newBalance,
      notification,
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
    const balanceCol = sql<number>`COALESCE(SUM(${ucRewardsLedgerTable.points}), 0)::integer`;
    const lifetimeRedeemedCol = sql<number>`COALESCE(SUM(-${ucRewardsLedgerTable.points}) FILTER (WHERE ${ucRewardsLedgerTable.eventType} = 'redemption'), 0)::integer`;

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
        lifetimeRedeemed: lifetimeRedeemedCol,
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

    const [organization] = await db.select({
      lifetimeRedeemed: sql<number>`COALESCE(SUM(-${ucRewardsLedgerTable.points}) FILTER (WHERE ${ucRewardsLedgerTable.eventType} = 'redemption'), 0)::integer`,
    }).from(ucRewardsLedgerTable);
    res.json({ customers: rows, lifetimeRedeemed: Number(organization?.lifetimeRedeemed ?? 0) });
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
//   ?from=<ISO>     — include entries on or after this date/time
//   ?to=<ISO>       — include entries through this date/time (date-only values include the full day)
//   ?eventType=<key> — filter to one event type
//   ?export=1      — returns CSV instead of JSON

router.get("/uc/admin/rewards/ledger", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const rawUserId = req.query["userId"];
  const userId = rawUserId ? parseInt(String(rawUserId), 10) : null;
  const wantCsv = req.query["export"] === "1";
  const fromRaw = typeof req.query["from"] === "string" ? req.query["from"].trim() : "";
  const toRaw = typeof req.query["to"] === "string" ? req.query["to"].trim() : "";
  const eventType = typeof req.query["eventType"] === "string" ? req.query["eventType"].trim() : "";
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const toIsDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(toRaw);
  const toExclusive = to && toIsDateOnly
    ? new Date(to.getTime() + 24 * 60 * 60 * 1000)
    : null;

  if (rawUserId && (userId === null || isNaN(userId))) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    res.status(400).json({ error: "from and to must be valid ISO date strings" });
    return;
  }
  if (eventType.length > 100) {
    res.status(400).json({ error: "eventType must be 100 characters or fewer" });
    return;
  }
  if (from && to && (toExclusive ? from >= toExclusive : from > to)) {
    res.status(400).json({ error: "from must be before or equal to to" });
    return;
  }

  try {
    const filters = [
      userId ? eq(ucRewardsLedgerTable.userId, userId) : undefined,
      from ? gte(ucRewardsLedgerTable.createdAt, from) : undefined,
      toExclusive
        ? lt(ucRewardsLedgerTable.createdAt, toExclusive)
        : to
          ? lte(ucRewardsLedgerTable.createdAt, to)
          : undefined,
      eventType ? eq(ucRewardsLedgerTable.eventType, eventType) : undefined,
    ].filter((condition) => condition !== undefined);

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
        notificationStatus: ucNotificationLogTable.status,
        notificationEvent: ucNotificationLogTable.deliveryEvent,
        notificationError: ucNotificationLogTable.errorMessage,
      })
      .from(ucRewardsLedgerTable)
      .innerJoin(ucUsersTable, eq(ucUsersTable.id, ucRewardsLedgerTable.userId))
      .leftJoin(ucNotificationLogTable, and(
        eq(ucNotificationLogTable.rewardLedgerId, ucRewardsLedgerTable.id),
        eq(ucNotificationLogTable.template, "reward-points"),
      ))
      .where(filters.length > 0 ? and(...filters) : undefined)
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
        `attachment; filename="${[
          "rewards-ledger",
          userId ? `user${userId}` : "",
          fromRaw ? `from-${fromRaw.slice(0, 10)}` : "",
          toRaw ? `to-${toRaw.slice(0, 10)}` : "",
          eventType ? `event-${eventType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "",
        ].filter(Boolean).join("-")}.csv"`,
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
