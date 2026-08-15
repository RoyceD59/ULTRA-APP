/**
 * Admin-only API for managing third-party integration settings stored in the DB.
 *
 * GET  /admin/integrations  — returns integration status metadata (never raw URLs)
 * PATCH /admin/integrations — validate, encrypt, and store an integration URL
 *
 * Security:
 *   - All routes require a valid team-session JWT with role === "admin".
 *   - Webhook URLs are validated against SSRF vectors (HTTPS-only, DNS-resolved
 *     IPs checked via ssrf-safe-fetch#validateWebhookDestination) before being stored.
 *   - URLs are AES-256-GCM encrypted before storage (same scheme as
 *     mpesa_webhook_secret_enc) because webhook URLs often embed bearer tokens.
 *   - GET never returns the raw URL or a path prefix — only isSet and the hostname.
 *   - Actual SSRF enforcement at request time is done by ssrfSafePost in the
 *     sync route (ssrf-safe-fetch.ts), so save-time validation is a UX guard.
 */

import { Router, type Request, type Response } from "express";
import { db, teamSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "../lib/secret-crypto.js";
import { validateWebhookDestination } from "../lib/ssrf-safe-fetch.js";
import { requireTeamAdmin } from "./auth.js";

const router = Router();

// ─── GET /admin/integrations ──────────────────────────────────────────────────
// Returns only status metadata — never the raw URL or any path prefix.
router.get(
  "/admin/integrations",
  requireTeamAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const [row] = await db
      .select()
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    const enc = row?.n8nInventoryWebhookUrlEnc ?? null;
    let hostname: string | null = null;

    if (enc) {
      const plainUrl = decryptSecret(enc);
      if (plainUrl) {
        try {
          hostname = new URL(plainUrl).hostname;
        } catch {
          hostname = null;
        }
      }
    }

    res.json({
      n8nInventoryWebhook: {
        isSet: Boolean(enc),
        // Return only the hostname — never the path (which may embed bearer tokens)
        hostname,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
      },
    });
  },
);

// ─── PATCH /admin/integrations ────────────────────────────────────────────────
router.patch(
  "/admin/integrations",
  requireTeamAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { n8nInventoryWebhookUrl } = req.body as { n8nInventoryWebhookUrl?: unknown };

    if (n8nInventoryWebhookUrl === undefined) {
      res.status(400).json({ error: "No recognized field to update" });
      return;
    }

    if (typeof n8nInventoryWebhookUrl !== "string") {
      res.status(400).json({ error: "n8nInventoryWebhookUrl must be a string" });
      return;
    }

    const trimmed = n8nInventoryWebhookUrl.trim();

    // Empty string = clear the URL
    if (!trimmed) {
      await db
        .insert(teamSettingsTable)
        .values({
          id: "singleton",
          n8nInventoryWebhookUrlEnc: null,
          updatedAt: new Date(),
        } as typeof teamSettingsTable.$inferInsert)
        .onConflictDoUpdate({
          target: teamSettingsTable.id,
          set: { n8nInventoryWebhookUrlEnc: null, updatedAt: new Date() },
        });
      res.json({ ok: true });
      return;
    }

    // Save-time SSRF guard — provides immediate admin feedback.
    // Request-time enforcement (DNS re-resolution + IP pinning) happens in
    // ssrfSafePost inside the sync route on every actual outbound call.
    const ssrfError = await validateWebhookDestination(trimmed);
    if (ssrfError) {
      res.status(400).json({ error: ssrfError });
      return;
    }

    // Encrypt before storage — webhook URLs often embed bearer-style path tokens
    let encrypted: string;
    try {
      encrypted = encryptSecret(trimmed);
    } catch {
      res.status(503).json({
        error: "Cannot store webhook URL: SESSION_SECRET is not configured",
      });
      return;
    }

    await db
      .insert(teamSettingsTable)
      .values({
        id: "singleton",
        n8nInventoryWebhookUrlEnc: encrypted,
        updatedAt: new Date(),
      } as typeof teamSettingsTable.$inferInsert)
      .onConflictDoUpdate({
        target: teamSettingsTable.id,
        set: { n8nInventoryWebhookUrlEnc: encrypted, updatedAt: new Date() },
      });

    res.json({ ok: true });
  },
);

export default router;
