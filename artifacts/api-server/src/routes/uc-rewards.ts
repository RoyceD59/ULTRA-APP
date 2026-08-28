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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, pool, ucNotificationLogTable, ucRewardsRulesTable, ucRewardsLedgerTable,
  ucUsersTable, ucRewardConversionTable, teamUsersTable,
} from "@workspace/db";
import { eq, desc, sql, or, and, isNull, ilike } from "drizzle-orm";
import { requireAdmin, adminEmailList } from "../lib/adminAuth.js";
import { verifyToken } from "../lib/jwt.js";
import { sendRewardPushNotification } from "../lib/push.js";
import { normalizeEmail, normalizePhone } from "../lib/customer-identity.js";

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
  const totalLitres = filters.reduce((sum, filter) => sum + filter.usedLitres, 0);
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
      .select({ balance: sql<number>`COALESCE(SUM(${ucRewardsLedgerTable.points}), 0)` })
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
      const error = new Error("Litres exceed this filter's remaining rated capacity") as Error & { code?: string; remaining?: number };
      error.code = "CAPACITY_EXCEEDED";
      error.remaining = Math.max(0, capacity - used);
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
  }).from(ucRewardsLedgerTable).where(eq(ucRewardsLedgerTable.userId, customer.id));
  res.json({
    customer: maskedCustomer(customer),
    balance: Number(balanceRow?.balance ?? 0),
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
  res.json({ conversion: conversion ?? { id: "singleton", mode: "kes", value: "100", active: true } });
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

/** Atomic staff award/redeem, protected by a per-customer transaction lock. */
router.post("/uc/admin/rewards/transaction", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const lookup = typeof req.body?.lookup === "string" ? req.body.lookup : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim().slice(0, 200) : "";
  const direction = req.body?.direction;
  const amount = Number(req.body?.points);
  if ((direction !== "award" && direction !== "redeem") || !Number.isInteger(amount) || amount <= 0 ||
      !reason || !idempotencyKey || !lookup.trim() || (direction === "redeem" && amount % 1000 !== 0)) {
    res.status(400).json({ error: "A direction, positive whole points, reason, lookup, and idempotencyKey are required; redemptions must be 1,000-point blocks" });
    return;
  }
  const customer = await resolveCustomer(lookup);
  if (!customer) { res.status(404).json({ error: "No active account found for this lookup" }); return; }
  const actor = await adminActor(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [customer.id]);
    const refId = `staff:${idempotencyKey}`;
    const prior = await client.query(`SELECT * FROM uc_rewards_ledger WHERE user_id = $1 AND ref_id = $2`, [customer.id, refId]);
    if (prior.rows[0]) {
      const bal = await client.query(`SELECT COALESCE(SUM(points), 0)::integer AS balance FROM uc_rewards_ledger WHERE user_id = $1`, [customer.id]);
      await client.query("COMMIT");
      res.json({ entry: prior.rows[0], newBalance: Number(bal.rows[0].balance), repeated: true });
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
    }
    const snapshot = conversion ? ` [${conversion.mode}:${conversion.value} per 1000 points]` : "";
    const inserted = await client.query(
      `INSERT INTO uc_rewards_ledger (user_id, points, reason, event_type, ref_id, granted_by, conversion_mode, conversion_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [customer.id, direction === "redeem" ? -amount : amount, `${reason}${snapshot}`, direction === "redeem" ? "redemption" : "manual", refId, actor, conversion?.mode ?? null, conversion?.value ?? null],
    );
    const bal = await client.query(`SELECT COALESCE(SUM(points), 0)::integer AS balance FROM uc_rewards_ledger WHERE user_id = $1`, [customer.id]);
    await client.query("COMMIT");
    const newBalance = Number(bal.rows[0].balance);
    const entry = inserted.rows[0];
    const notification = await sendRewardPushNotification({
      userId: customer.id, ledgerId: Number(entry.id),
      title: direction === "redeem" ? "Points redeemed" : "Points earned",
      body: direction === "redeem" ? `${amount} points redeemed. Balance: ${newBalance} pts.` : `You earned ${amount} points. Balance: ${newBalance} pts.`,
    });
    res.status(201).json({ entry, newBalance, repeated: false, conversion, notification });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[uc/admin/rewards/transaction] error:", err);
    res.status(500).json({ error: "Failed to record rewards transaction" });
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
