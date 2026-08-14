import { Router, type IRouter, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db, tasksTable, systemStatusTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  IngestWebhookBody,
  IngestWebhookResponse,
} from "@workspace/api-zod";
import { requireTeamAuth } from "./auth.js";

const router: IRouter = Router();

/** Verify X-Webhook-Signature header using HMAC-SHA256 over the raw body. */
function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  // Accept "sha256=<hex>" or bare hex
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ─── Shared ingest logic ──────────────────────────────────────────────────────
// Called by both the public /webhook/ingest route (after signature verification)
// and the authenticated /webhook/test-dispatch route (after team auth check).
async function processIngestPayload(
  body: unknown,
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = IngestWebhookBody.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { event, sourcePlatform, taskData } = parsed.data;
  const validationErrors: string[] = [];

  // Validation layer: mandatory field check before syncing
  if (taskData) {
    if (taskData.assigneeId == null) {
      validationErrors.push("taskData.assigneeId is required");
    }
    if (!taskData.resourceRequired) {
      validationErrors.push("taskData.resourceRequired is required");
    }
    if (!taskData.deliveryFormat) {
      validationErrors.push("taskData.deliveryFormat is required");
    }
  }

  if (validationErrors.length > 0) {
    req.log.warn({ validationErrors, sourcePlatform, event }, "Webhook validation failed");
    res.status(400).json(
      IngestWebhookResponse.parse({
        accepted: false,
        taskId: null,
        message: "Validation failed — missing required fields",
        validationErrors,
      })
    );
    return;
  }

  // Update system_status lastSync for the source platform
  try {
    await db
      .update(systemStatusTable)
      .set({ lastSync: new Date(), lastChecked: new Date(), status: "connected" })
      .where(eq(systemStatusTable.platform, sourcePlatform));
  } catch (_e) {
    // Non-fatal — platform may not be registered yet
  }

  // Create the task if taskData is provided
  let taskId: number | null = null;
  if (taskData && taskData.projectId && taskData.title) {
    try {
      const [task] = await db
        .insert(tasksTable)
        .values({
          projectId: taskData.projectId,
          title: taskData.title,
          description: taskData.description ?? "",
          status: (taskData.status as string) ?? "todo",
          priority: (taskData.priority as string) ?? "medium",
          assigneeId: taskData.assigneeId ?? null,
          dueDate: taskData.dueDate ?? null,
          sourcePlatform,
          resourceRequired: taskData.resourceRequired ?? null,
          deliveryFormat: taskData.deliveryFormat ?? null,
          notifyVia: taskData.notifyVia ?? null,
        })
        .returning();
      taskId = task?.id ?? null;
      req.log.info({ taskId, sourcePlatform, event }, "Webhook task ingested");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ error: message }, "Failed to create task from webhook");
      res.status(500).json({ error: "Failed to ingest task" });
      return;
    }
  }

  res.json(
    IngestWebhookResponse.parse({
      accepted: true,
      taskId,
      message: `Event '${event}' from '${sourcePlatform}' accepted`,
      validationErrors: [],
    })
  );
}

// ─── Public ingest route ───────────────────────────────────────────────────────
// Accepts incoming webhooks from external orchestration systems.
// Always enforces HMAC-SHA256 signature verification — rejects when the secret
// is not configured so there is never an unauthenticated processing path.
router.post("/webhook/ingest", async (req, res): Promise<void> => {
  // ── HMAC signature check ────────────────────────────────────────────────────
  const secret = process.env["PROJECTHUB_WEBHOOK_SECRET"];
  if (!secret) {
    console.error(
      "[webhook/ingest] PROJECTHUB_WEBHOOK_SECRET is not set — rejecting request. " +
        "Configure the secret to enable webhook ingestion."
    );
    res.status(503).json({
      error: "Webhook ingestion is not available: webhook secret is not configured.",
    });
    return;
  }

  // Use the exact raw bytes captured by the middleware in app.ts — do NOT fall
  // back to re-serialising req.body, because JSON.stringify may produce a
  // different byte sequence (different key order, whitespace) than the sender,
  // which would cause the HMAC to fail for legitimate requests.
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Raw body unavailable for signature check" });
    return;
  }

  const sig = req.headers["x-webhook-signature"] as string | undefined;
  if (!verifyWebhookSignature(rawBody, sig, secret)) {
    res.status(401).json({ error: "Invalid or missing webhook signature" });
    return;
  }

  await processIngestPayload(req.body, req, res);
});

// ─── Authenticated test-dispatch route ────────────────────────────────────────
// Allows authenticated team members to fire a test ingest payload from the
// Webhook Tester UI without exposing the shared secret to the browser.
// Access is gated by team JWT (requireTeamAuth) rather than HMAC, so the ingest
// business logic is exercised directly without going through signature
// verification — this is intentional and safe because the caller is a
// verified team member, not an anonymous external system.
router.post("/webhook/test-dispatch", requireTeamAuth, async (req, res): Promise<void> => {
  const secret = process.env["PROJECTHUB_WEBHOOK_SECRET"];
  if (!secret) {
    res.status(503).json({
      error: "Webhook ingestion is not available: webhook secret is not configured.",
    });
    return;
  }
  logger.info({ path: "/webhook/test-dispatch" }, "Authenticated test dispatch");
  await processIngestPayload(req.body, req, res);
});

export default router;
