/**
 * Admin-only API for inventory alert settings stored in team_settings.
 *
 * GET  /admin/inventory-settings  — returns current low_stock_threshold
 * PATCH /admin/inventory-settings — update low_stock_threshold
 *
 * All routes require a valid team-session JWT with role === "admin".
 */

import { Router, type Request, type Response } from "express";
import { db, teamSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireTeamAdmin } from "./auth.js";

const router = Router();

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

// ─── GET /admin/inventory-settings ───────────────────────────────────────────
router.get(
  "/admin/inventory-settings",
  requireTeamAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const [row] = await db
      .select({ lowStockThreshold: teamSettingsTable.lowStockThreshold })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    const dbValue = row?.lowStockThreshold ?? null;
    res.json({
      lowStockThreshold: {
        value: dbValue ?? DEFAULT_LOW_STOCK_THRESHOLD,
        source: dbValue !== null ? "db" : "default",
      },
    });
  },
);

// ─── PATCH /admin/inventory-settings ─────────────────────────────────────────
router.patch(
  "/admin/inventory-settings",
  requireTeamAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { lowStockThreshold } = req.body as { lowStockThreshold?: unknown };

    if (lowStockThreshold === undefined) {
      res.status(400).json({ error: "lowStockThreshold is required" });
      return;
    }

    const val = Number(lowStockThreshold);
    if (!Number.isInteger(val) || val < 0 || val > 10000) {
      res.status(400).json({ error: "lowStockThreshold must be an integer between 0 and 10000" });
      return;
    }

    await db
      .insert(teamSettingsTable)
      .values({ id: "singleton", lowStockThreshold: val, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: teamSettingsTable.id,
        set: { lowStockThreshold: val, updatedAt: new Date() },
      });

    console.info("[admin/inventory-settings] lowStockThreshold updated to", val);
    res.json({ ok: true, lowStockThreshold: val });
  },
);

export default router;
