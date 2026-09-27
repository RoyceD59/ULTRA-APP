/**
 * Admin-only API for inventory alert settings stored in team_settings.
 *
 * GET  /admin/inventory-settings  — returns current inventory alert thresholds
 * PATCH /admin/inventory-settings — update one or both alert thresholds
 *
 * All routes require a valid team-session JWT with role === "admin".
 */

import { Router, type Request, type Response } from "express";
import { db, teamSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireTeamAdmin } from "./auth.js";

const router = Router();

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const DEFAULT_RESTOCK_DEMAND_THRESHOLD = 5;

// ─── GET /admin/inventory-settings ───────────────────────────────────────────
router.get(
  "/admin/inventory-settings",
  requireTeamAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const [row] = await db
      .select({
        lowStockThreshold: teamSettingsTable.lowStockThreshold,
        restockDemandThreshold: teamSettingsTable.restockDemandThreshold,
      })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    const dbValue = row?.lowStockThreshold ?? null;
    res.json({
      lowStockThreshold: {
        value: dbValue ?? DEFAULT_LOW_STOCK_THRESHOLD,
        source: dbValue !== null ? "db" : "default",
      },
      restockDemandThreshold: {
        value: row?.restockDemandThreshold ?? DEFAULT_RESTOCK_DEMAND_THRESHOLD,
        source: row?.restockDemandThreshold != null ? "db" : "default",
      },
    });
  },
);

// ─── PATCH /admin/inventory-settings ─────────────────────────────────────────
router.patch(
  "/admin/inventory-settings",
  requireTeamAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { lowStockThreshold, restockDemandThreshold } = req.body as {
      lowStockThreshold?: unknown;
      restockDemandThreshold?: unknown;
    };

    if (lowStockThreshold === undefined && restockDemandThreshold === undefined) {
      res.status(400).json({ error: "At least one inventory alert threshold is required" });
      return;
    }

    let lowStockValue: number | undefined;
    if (lowStockThreshold !== undefined) {
      const val = Number(lowStockThreshold);
      if (!Number.isInteger(val) || val < 0 || val > 10000) {
        res.status(400).json({ error: "lowStockThreshold must be an integer between 0 and 10000" });
        return;
      }
      lowStockValue = val;
    }

    let restockDemandValue: number | undefined;
    if (restockDemandThreshold !== undefined) {
      const val = Number(restockDemandThreshold);
      if (!Number.isInteger(val) || val < 1 || val > 10000) {
        res.status(400).json({ error: "restockDemandThreshold must be an integer between 1 and 10000" });
        return;
      }
      restockDemandValue = val;
    }

    const values: {
      id: string;
      lowStockThreshold?: number;
      restockDemandThreshold?: number;
      updatedAt: Date;
    } = { id: "singleton", updatedAt: new Date() };
    const updates: {
      lowStockThreshold?: number;
      restockDemandThreshold?: number;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (lowStockValue !== undefined) {
      values.lowStockThreshold = lowStockValue;
      updates.lowStockThreshold = lowStockValue;
    }
    if (restockDemandValue !== undefined) {
      values.restockDemandThreshold = restockDemandValue;
      updates.restockDemandThreshold = restockDemandValue;
    }

    await db
      .insert(teamSettingsTable)
      .values(values)
      .onConflictDoUpdate({
        target: teamSettingsTable.id,
        set: updates,
      });

    console.info("[admin/inventory-settings] inventory alert thresholds updated", {
      lowStockThreshold: lowStockValue,
      restockDemandThreshold: restockDemandValue,
    });
    res.json({
      ok: true,
      ...(lowStockValue !== undefined ? { lowStockThreshold: lowStockValue } : {}),
      ...(restockDemandValue !== undefined ? { restockDemandThreshold: restockDemandValue } : {}),
    });
  },
);

export default router;
