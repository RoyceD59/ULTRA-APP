import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  getWhatsAppStatus,
  initWhatsApp,
  disconnectWhatsApp,
  sendWhatsAppMessage,
} from "../lib/whatsapp";
import { verifyToken } from "../lib/jwt.js";
import { db, notificationLogsTable } from "@workspace/db";

// ─── Auth middleware ──────────────────────────────────────────────────────────

/**
 * Requires a valid "team-session" JWT issued by POST /api/auth/token.
 * Rejects with 401 for missing/invalid tokens and for tokens of a different
 * type (e.g. UC customer JWTs must not be usable here).
 */
function requireTeamAuth(req: Request, res: Response, next: NextFunction): void {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims || claims.type !== "team-session") {
    res.status(401).json({ error: "Authentication required. Obtain a token via POST /api/auth/token." });
    return;
  }
  next();
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router: IRouter = Router();

/**
 * GET /api/whatsapp/status
 * Returns current connection state and QR code (as base64 data URI) if
 * the socket is waiting to be paired.
 *
 * Response:
 *   { state: "disconnected" | "connecting" | "qr" | "connected" | "error",
 *     qr?: string, error?: { code: string, message: string } }
 */
router.get("/whatsapp/status", requireTeamAuth, (_req, res): void => {
  res.json(getWhatsAppStatus());
});

/**
 * POST /api/whatsapp/connect
 * Triggers the pairing flow.  Idempotent — safe to call if already connected.
 */
router.post("/whatsapp/connect", requireTeamAuth, async (_req, res): Promise<void> => {
  try {
    await initWhatsApp();
    res.json(getWhatsAppStatus());
  } catch {
    // Keep provider/runtime details out of the public response. The status
    // endpoint will expose the recoverable state when initialization failed.
    res.status(503).json({
      error: {
        code: "WHATSAPP_INIT_FAILED",
        message: "WhatsApp could not start. Check the server configuration and retry.",
      },
    });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Logs out the current session and wipes stored credentials.
 */
router.post("/whatsapp/disconnect", requireTeamAuth, async (_req, res): Promise<void> => {
  await disconnectWhatsApp();
  res.json({ ok: true, state: "disconnected" });
});

/**
 * POST /api/whatsapp/send
 * Send a free-form WhatsApp message to any phone number.
 * Only works when the session is connected.
 *
 * Body: { to: string, message: string }
 * Response: { ok: true } | { error: string }
 */
router.post("/whatsapp/send", requireTeamAuth, async (req, res): Promise<void> => {
  const { to, message } = req.body ?? {};

  if (!to || typeof to !== "string" || to.trim() === "") {
    res.status(400).json({ error: "Field 'to' (phone number) is required." });
    return;
  }
  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "Field 'message' (text body) is required." });
    return;
  }

  try {
    const whatsappMessageId = await sendWhatsAppMessage(to.trim(), message.trim());

    // Write an audit row so the message appears in the dispatch log
    await db.insert(notificationLogsTable).values({
      contactId: null,
      taskId: null,
      channelType: "whatsapp",
      channelValue: to.trim(),
      templateId: "QUICK_MESSAGE",
      subject: "",
      body: message.trim(),
      status: "sent",
      whatsappMessageId: whatsappMessageId ?? null,
    });

    res.json({ ok: true, to: to.trim() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Send failed";
    // 503 when not connected; 500 for anything else
    const statusCode = msg.includes("not connected") ? 503 : 500;
    res.status(statusCode).json({ error: msg });
  }
});

export default router;
