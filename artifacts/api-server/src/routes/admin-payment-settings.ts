/**
 * Admin-only API for managing payment integration settings stored in the DB.
 *
 * GET  /admin/payment-settings  — returns masked status (never plaintext secrets)
 * PATCH /admin/payment-settings — set/rotate a setting
 *
 * All routes require a valid team-session JWT with role === "admin".
 */

import { Router, type Request, type Response } from "express";
import { db, teamSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../lib/secret-crypto.js";
import { requireTeamAdmin } from "./auth.js";
import { invalidateMpesaSecretCache } from "./payments.js";

const router = Router();

// ─── GET /admin/payment-settings ──────────────────────────────────────────────
// Returns non-sensitive metadata: whether each secret is configured and its source.
router.get(
  "/admin/payment-settings",
  requireTeamAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const [row] = await db
      .select()
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    const hasDbSecret = Boolean(row?.mpesaWebhookSecretEnc);
    const hasEnvSecret = Boolean(process.env["MPESA_WEBHOOK_SECRET"]);

    res.json({
      mpesaWebhookSecret: {
        // "db" wins; "env" is the legacy fallback; "none" means unprotected
        source: hasDbSecret ? "db" : hasEnvSecret ? "env" : "none",
        isSet: hasDbSecret || hasEnvSecret,
        // Hint: last 4 chars of the env secret (never the DB one — we don't decrypt to show)
        envHint: hasEnvSecret && !hasDbSecret
          ? `…${process.env["MPESA_WEBHOOK_SECRET"]!.slice(-4)}`
          : null,
        updatedAt: row?.updatedAt ?? null,
      },
    });
  }
);

// ─── PATCH /admin/payment-settings ────────────────────────────────────────────
// Set or rotate a payment setting. Only the fields present in the body are updated.
router.patch(
  "/admin/payment-settings",
  requireTeamAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { mpesaWebhookSecret } = req.body as {
      mpesaWebhookSecret?: string;
    };

    if (mpesaWebhookSecret !== undefined) {
      if (typeof mpesaWebhookSecret !== "string" || mpesaWebhookSecret.trim() === "") {
        res.status(400).json({ error: "mpesaWebhookSecret must be a non-empty string" });
        return;
      }

      let encrypted: string;
      try {
        encrypted = encryptSecret(mpesaWebhookSecret.trim());
      } catch (err) {
        console.error("[admin/payment-settings] Encryption failed:", err);
        res.status(500).json({
          error:
            "Failed to encrypt the secret. Make sure SESSION_SECRET is configured on the server.",
        });
        return;
      }

      await db
        .insert(teamSettingsTable)
        .values({ id: "singleton", mpesaWebhookSecretEnc: encrypted })
        .onConflictDoUpdate({
          target: teamSettingsTable.id,
          set: {
            mpesaWebhookSecretEnc: encrypted,
            updatedAt: new Date(),
          },
        });

      // Bust the in-process cache so the callback handler picks up the new
      // secret immediately without waiting for the 60-second TTL to expire.
      invalidateMpesaSecretCache();

      console.info("[admin/payment-settings] M-Pesa webhook secret rotated via admin panel");
    }

    res.json({ ok: true });
  }
);

export default router;
