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
import { invalidateMpesaSecretCache, invalidateTeamAlertPhoneCache } from "./payments.js";
import { invalidateTeamAlertEmailCache } from "./uc.js";

const router = Router();

/** Mask an email address for display: keep first char + domain. e.g. "t…@ucfilters.com" */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}…${email.slice(at)}`;
}

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

    const dbPhone = row?.teamAlertPhone ?? null;
    const envPhone = process.env["TEAM_ALERT_PHONE"] ?? null;

    const dbEmail = row?.teamAlertEmail ?? null;
    const envEmail = process.env["TEAM_ALERT_EMAIL"]?.trim() || null;

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
      teamAlertPhone: {
        // "db" wins over env var; phone numbers are not secrets so we show a masked hint
        source: dbPhone ? "db" : envPhone ? "env" : "none",
        isSet: Boolean(dbPhone ?? envPhone),
        // Show last 4 digits as a hint regardless of source
        hint: dbPhone
          ? `…${dbPhone.slice(-4)}`
          : envPhone
          ? `…${envPhone.slice(-4)}`
          : null,
        updatedAt: row?.updatedAt ?? null,
      },
      teamAlertEmail: {
        // "db" wins over env var; falls back to hardcoded info@ucfilters.com
        source: dbEmail ? "db" : envEmail ? "env" : "default",
        isSet: true, // always has at least the fallback
        // Show partial address as a hint (domain kept, local-part masked beyond first char)
        hint: dbEmail
          ? maskEmail(dbEmail)
          : envEmail
          ? maskEmail(envEmail)
          : "info@ucfilters.com",
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
    const { mpesaWebhookSecret, teamAlertPhone, teamAlertEmail } = req.body as {
      mpesaWebhookSecret?: string;
      teamAlertPhone?: string;
      teamAlertEmail?: string;
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

    if (teamAlertPhone !== undefined) {
      const phone = typeof teamAlertPhone === "string" ? teamAlertPhone.trim() : "";
      if (!phone) {
        res.status(400).json({ error: "teamAlertPhone must be a non-empty string" });
        return;
      }

      await db
        .insert(teamSettingsTable)
        .values({ id: "singleton", teamAlertPhone: phone })
        .onConflictDoUpdate({
          target: teamSettingsTable.id,
          set: {
            teamAlertPhone: phone,
            updatedAt: new Date(),
          },
        });

      // Bust the in-process cache so alert sends pick up the new number immediately.
      invalidateTeamAlertPhoneCache();

      console.info("[admin/payment-settings] Team alert phone updated via admin panel:", phone.slice(-4).padStart(phone.length, "*"));
    }

    if (teamAlertEmail !== undefined) {
      const email = typeof teamAlertEmail === "string" ? teamAlertEmail.trim() : "";
      if (!email || !email.includes("@")) {
        res.status(400).json({ error: "teamAlertEmail must be a valid email address" });
        return;
      }

      await db
        .insert(teamSettingsTable)
        .values({ id: "singleton", teamAlertEmail: email })
        .onConflictDoUpdate({
          target: teamSettingsTable.id,
          set: {
            teamAlertEmail: email,
            updatedAt: new Date(),
          },
        });

      // Shared by deletion and recovery-order alerts; the next send uses the new address.
      invalidateTeamAlertEmailCache();

      console.info("[admin/payment-settings] Team alert email updated via admin panel:", maskEmail(email));
    }

    res.json({ ok: true });
  }
);

export default router;
