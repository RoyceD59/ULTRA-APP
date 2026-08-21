/**
 * Admin-only endpoints for surfacing and recovering registrations that landed
 * only in the durable folder (dbPersisted: false) due to a DB outage.
 *
 * GET  /admin/unsynced-registrations        — list folder records with dbPersisted:false
 * POST /admin/unsynced-registrations/retry  — insert the uc_users row and mark synced
 */

import { Router, type Request, type Response } from "express";
import { requireTeamAdmin } from "./auth.js";
import {
  listUnsyncedRegistrations,
  retryUnsyncedRegistration,
} from "../lib/account-records.js";

const router = Router();

// ─── GET /admin/unsynced-registrations ────────────────────────────────────────
router.get(
  "/admin/unsynced-registrations",
  requireTeamAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const records = await listUnsyncedRegistrations();
    res.json({ records });
  },
);

// ─── POST /admin/unsynced-registrations/retry ─────────────────────────────────
router.post(
  "/admin/unsynced-registrations/retry",
  requireTeamAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { email, recordedAt } = req.body as {
      email?: unknown;
      recordedAt?: unknown;
    };

    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "email is required" });
      return;
    }
    if (typeof recordedAt !== "string" || !recordedAt.trim()) {
      res.status(400).json({ error: "recordedAt is required" });
      return;
    }

    const result = await retryUnsyncedRegistration(email.toLowerCase().trim(), recordedAt);
    res.json(result);
  },
);

export default router;
