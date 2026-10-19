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
import { reconcileAssignmentsForAccount } from "../lib/customer-assignments.js";
import {
  clearResolvedRegistrations,
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
    const {
      email,
      originalEmail,
      originalPhone,
      correctedEmail,
      correctedPhone,
      targetAccountId,
      target,
      createAccount,
      recordedAt,
    } = req.body as {
      email?: unknown;
      originalEmail?: unknown;
      originalPhone?: unknown;
      correctedEmail?: unknown;
      correctedPhone?: unknown;
      targetAccountId?: unknown;
      target?: unknown;
      createAccount?: unknown;
      recordedAt?: unknown;
    };

    const ledgerEmail = typeof originalEmail === "string" ? originalEmail : email;
    if ((typeof ledgerEmail !== "string" || !ledgerEmail.trim()) &&
        (typeof originalPhone !== "string" || !originalPhone.trim())) {
      res.status(400).json({ code: "LEDGER_IDENTITY_REQUIRED", error: "The original ledger email or phone is required." });
      return;
    }
    const ledgerIdentityEmail = typeof ledgerEmail === "string" ? ledgerEmail.trim() : "";
    if (typeof recordedAt !== "string" || !recordedAt.trim()) {
      res.status(400).json({ code: "RECORDED_AT_REQUIRED", error: "The original ledger timestamp is required." });
      return;
    }

    const targetValue = target && typeof target === "object" ? target as Record<string, unknown> : {};
    const selectedTargetId = targetAccountId ?? targetValue["accountId"];
    const isNewAccount = createAccount === true || target === "new" || targetValue["type"] === "new";
    if (selectedTargetId !== undefined && (!Number.isInteger(Number(selectedTargetId)) || Number(selectedTargetId) <= 0)) {
      res.status(400).json({ code: "TARGET_ACCOUNT_INVALID", error: "Select an existing account or choose new account." });
      return;
    }
    if (!isNewAccount && selectedTargetId === undefined && (correctedEmail !== undefined || correctedPhone !== undefined)) {
      res.status(400).json({ code: "TARGET_ACCOUNT_REQUIRED", error: "Select an existing account or explicitly choose new account." });
      return;
    }
    if (correctedEmail !== undefined && (typeof correctedEmail !== "string" || !correctedEmail.trim())) {
      res.status(400).json({ code: "CORRECTED_EMAIL_INVALID", error: "Enter a corrected email address." });
      return;
    }
    if (correctedPhone !== undefined && typeof correctedPhone !== "string") {
      res.status(400).json({ code: "CORRECTED_PHONE_INVALID", error: "Enter a corrected phone number." });
      return;
    }

    try {
      const result = await retryUnsyncedRegistration(ledgerIdentityEmail, recordedAt, {
        originalPhone: typeof originalPhone === "string" ? originalPhone : undefined,
        correctedEmail: typeof correctedEmail === "string" ? correctedEmail : undefined,
        correctedPhone: typeof correctedPhone === "string" ? correctedPhone : undefined,
        targetAccountId: selectedTargetId === undefined ? undefined : Number(selectedTargetId),
        createAccount: isNewAccount,
        resolvedBy: typeof (req as Request & { teamUser?: { id?: string } }).teamUser?.id === "string"
          ? (req as Request & { teamUser?: { id?: string } }).teamUser?.id
          : "admin",
      });
      if (result.status === "blocked") {
        res.status(409).json({
          ...result,
          code: "IDENTITY_CONFLICT",
          error: "The corrected identity is already owned by a different account.",
        });
        return;
      }
      if (result.id) void reconcileAssignmentsForAccount(result.id);
      res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No folder record found")) {
        res.status(404).json({ code: "LEDGER_RECORD_NOT_FOUND", error: "Registration record not found." });
        return;
      }
      if (error instanceof Error && /required|valid corrected|target account/i.test(error.message)) {
        res.status(400).json({ code: "RECOVERY_INPUT_INVALID", error: error.message });
        return;
      }
      throw error;
    }
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

router.post(
  "/admin/unsynced-registrations/clear-resolved",
  requireTeamAdmin,
  async (req: Request, res: Response): Promise<void> => {
    if (req.body?.confirm !== true) {
      res.status(400).json({
        code: "CONFIRMATION_REQUIRED",
        error: "Set confirm to true to clear database-persisted resolved records.",
      });
      return;
    }
    const cleared = await clearResolvedRegistrations();
    res.json({ cleared });
  },
);

export default router;
