/**
 * Admin-only endpoints for surfacing and recovering registrations that landed
 * only in the durable folder (dbPersisted: false) due to a DB outage.
 *
 * GET  /admin/unsynced-registrations        — list folder records with dbPersisted:false
 * POST /admin/unsynced-registrations/retry  — insert the uc_users row and mark synced
 * POST /admin/unsynced-registrations/resolve — mark staff follow-up complete
 */

import { Router, type Request, type Response } from "express";
import { requireTeamAdmin } from "./auth.js";
import {
  listUnsyncedRegistrations,
  resolveUnsyncedRegistration,
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

router.post(
  "/admin/unsynced-registrations/resolve",
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

    try {
      const record = await resolveUnsyncedRegistration(email, recordedAt);
      res.json({ record });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No folder record found")) {
        res.status(404).json({ error: "Registration record not found" });
        return;
      }
      throw error;
    }
  },
);

export default router;
