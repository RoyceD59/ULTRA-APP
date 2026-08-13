/**
 * Admin-only API for managing notification log retention settings stored in the DB.
 *
 * GET  /admin/notification-settings  — returns current retention values and their sources
 * PATCH /admin/notification-settings — update one or both retention windows
 *
 * All routes require a valid team-session JWT with role === "admin".
 */

import { Router, type Request, type Response } from "express";
import { db, teamSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireTeamAdmin } from "./auth.js";

const router = Router();

const ENV_SUCCESS_KEY = "UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS";
const ENV_FAILURE_KEY = "UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS";
const DEFAULT_SUCCESS = 30;
const DEFAULT_FAILURE = 90;

// ─── GET /admin/notification-settings ─────────────────────────────────────────
router.get(
  "/admin/notification-settings",
  requireTeamAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const [row] = await db
      .select()
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    const dbSuccess = row?.notificationLogSuccessRetentionDays ?? null;
    const dbFailure = row?.notificationLogFailureRetentionDays ?? null;
    const envSuccess = process.env[ENV_SUCCESS_KEY]
      ? parseInt(process.env[ENV_SUCCESS_KEY]!, 10) || DEFAULT_SUCCESS
      : null;
    const envFailure = process.env[ENV_FAILURE_KEY]
      ? parseInt(process.env[ENV_FAILURE_KEY]!, 10) || DEFAULT_FAILURE
      : null;

    res.json({
      successRetentionDays: {
        value: dbSuccess ?? envSuccess ?? DEFAULT_SUCCESS,
        source: dbSuccess !== null ? "db" : envSuccess !== null ? "env" : "default",
        updatedAt: row?.updatedAt ?? null,
      },
      failureRetentionDays: {
        value: dbFailure ?? envFailure ?? DEFAULT_FAILURE,
        source: dbFailure !== null ? "db" : envFailure !== null ? "env" : "default",
        updatedAt: row?.updatedAt ?? null,
      },
    });
  },
);

// ─── PATCH /admin/notification-settings ───────────────────────────────────────
router.patch(
  "/admin/notification-settings",
  requireTeamAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { successRetentionDays, failureRetentionDays } = req.body as {
      successRetentionDays?: unknown;
      failureRetentionDays?: unknown;
    };

    if (successRetentionDays === undefined && failureRetentionDays === undefined) {
      res.status(400).json({ error: "At least one field must be provided" });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const inserts: Record<string, unknown> = { id: "singleton", updatedAt: new Date() };

    if (successRetentionDays !== undefined) {
      const val = Number(successRetentionDays);
      if (!Number.isInteger(val) || val < 1 || val > 3650) {
        res.status(400).json({ error: "successRetentionDays must be an integer between 1 and 3650" });
        return;
      }
      updates.notificationLogSuccessRetentionDays = val;
      inserts.notificationLogSuccessRetentionDays = val;
    }

    if (failureRetentionDays !== undefined) {
      const val = Number(failureRetentionDays);
      if (!Number.isInteger(val) || val < 1 || val > 3650) {
        res.status(400).json({ error: "failureRetentionDays must be an integer between 1 and 3650" });
        return;
      }
      updates.notificationLogFailureRetentionDays = val;
      inserts.notificationLogFailureRetentionDays = val;
    }

    await db
      .insert(teamSettingsTable)
      .values(inserts as typeof teamSettingsTable.$inferInsert)
      .onConflictDoUpdate({
        target: teamSettingsTable.id,
        set: updates as Partial<typeof teamSettingsTable.$inferSelect>,
      });

    console.info("[admin/notification-settings] Notification log retention updated:", updates);
    res.json({ ok: true });
  },
);

export default router;
