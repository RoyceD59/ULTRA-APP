/**
 * Filter-reminder sync endpoint for the Ultra-Clear Companion app.
 *
 * The app keeps the authoritative filter activation in AsyncStorage and
 * schedules local push notifications itself. This route receives a mirror of
 * that activation so the daily server job (lib/reminder-dispatch.ts) can also
 * deliver lifecycle reminders via email / SMS / WhatsApp for opted-in users.
 *
 * PUT /api/uc/reminders/sync   (authenticated)
 *   Body: { activation: null | {
 *     productId: number, productName: string, lifespanDays: number,
 *     activatedAt: string (ISO), sourceOrderId?: number
 *   } }
 *   - null  → the user cleared their activation: soft-disable the row.
 *   - value → upsert. Starting a new cycle (different product or activation
 *             date) resets the sent-stage tracking.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, ucFilterRemindersTable, ucUsersTable } from "@workspace/db";
import { verifyToken } from "../lib/jwt.js";
import { logger } from "../lib/logger";
import { lookupLimiter } from "../lib/rate-limiters.js";

const router: IRouter = Router();

/** Oldest activation date the server accepts (guards sent-stage reset abuse). */
const MAX_ACTIVATION_AGE_MS = 3 * 365 * 86_400_000; // 3 years
/** Small clock-skew allowance for "future" activation timestamps. */
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000; // 1 hour

interface SyncBody {
  activation: null | {
    productId: number;
    productName: string;
    lifespanDays: number;
    activatedAt: string;
    sourceOrderId?: number;
  };
}

router.put("/uc/reminders/sync", lookupLimiter, async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  const userId = claims ? String(claims.id ?? "") : "";
  if (!userId || !/^\d+$/.test(userId)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Deleted accounts must not keep receiving messages.
  const [user] = await db
    .select({ id: ucUsersTable.id })
    .from(ucUsersTable)
    .where(and(eq(ucUsersTable.id, Number(userId)), isNull(ucUsersTable.deletedAt)))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = req.body as SyncBody;
  if (!body || !("activation" in body)) {
    res.status(400).json({ error: "Missing activation field" });
    return;
  }

  try {
    if (body.activation === null) {
      // Soft-disable — keeps sent-stage history in case the same cycle returns.
      await db
        .update(ucFilterRemindersTable)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(ucFilterRemindersTable.userId, userId));
      res.json({ ok: true, active: false });
      return;
    }

    const a = body.activation;
    const activatedAt = new Date(a.activatedAt);
    if (
      !Number.isInteger(a.productId) ||
      typeof a.productName !== "string" ||
      a.productName.length === 0 ||
      a.productName.length > 300 ||
      typeof a.lifespanDays !== "number" ||
      !Number.isFinite(a.lifespanDays) ||
      a.lifespanDays < 0 ||
      a.lifespanDays > 10000 ||
      Number.isNaN(activatedAt.getTime()) ||
      (a.sourceOrderId != null && !Number.isInteger(a.sourceOrderId))
    ) {
      res.status(400).json({ error: "Invalid activation payload" });
      return;
    }

    // Activation date sanity — blocks sent-stage reset abuse via wandering
    // timestamps (each "new cycle" re-arms reminder messages).
    const age = Date.now() - activatedAt.getTime();
    if (age < -MAX_FUTURE_SKEW_MS || age > MAX_ACTIVATION_AGE_MS) {
      res.status(400).json({ error: "Activation date out of range" });
      return;
    }

    const [existing] = await db
      .select()
      .from(ucFilterRemindersTable)
      .where(eq(ucFilterRemindersTable.userId, userId))
      .limit(1);

    // New cycle = different product or a different activation timestamp.
    const isNewCycle =
      !existing ||
      existing.productId !== a.productId ||
      existing.activatedAt.getTime() !== activatedAt.getTime();

    const values = {
      productId: a.productId,
      productName: a.productName.trim(),
      lifespanDays: Math.floor(a.lifespanDays),
      activatedAt,
      sourceOrderId: a.sourceOrderId ?? null,
      active: true,
      updatedAt: new Date(),
      ...(isNewCycle ? { sentStages: [] as string[] } : {}),
    };

    await db
      .insert(ucFilterRemindersTable)
      .values({ userId, ...values, sentStages: isNewCycle ? [] : (existing?.sentStages ?? []) })
      .onConflictDoUpdate({ target: ucFilterRemindersTable.userId, set: values });

    res.json({ ok: true, active: true, newCycle: isNewCycle });
  } catch (err) {
    logger.error({ err, userId }, "reminder sync failed");
    res.status(500).json({ error: "Failed to sync reminder" });
  }
});

export default router;
