import { Router, type IRouter, type Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { desc, eq, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, aiReportsTable, aiPushEventsTable, tasksTable } from "@workspace/db";
import { requireTeamAuth } from "../auth.js";
import {
  AiQueryBody,
  AiQueryResponse,
  GetAiReportResponse,
  GenerateAiReportResponse,
  PushToOrchestratorResponse,
  ListAiPushEventsResponse,
  AiPushEchoBody,
  AiPushEchoResponse,
} from "@workspace/api-zod";
import { buildProjectContext } from "./context";
import { sendViaResend } from "../../lib/resend.js";

const router: IRouter = Router();

interface AiReport {
  summary: string;
  highlights: string[];
  risks: string[];
  generatedAt: Date;
}

// In-memory cache for the latest report. This is only a fast-path cache —
// the source of truth is the ai_reports table, so a restart no longer wipes
// the report (and no longer silently forces a regeneration).
let latestReport: AiReport | null = null;

/** Statuses the orchestrator may echo back for a push. */
export const ECHO_STATUSES = ["received", "processing", "completed", "failed"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Report persistence
// ─────────────────────────────────────────────────────────────────────────────

/** Insert a freshly generated report; keeps only the newest 20 rows. */
async function persistReport(report: AiReport): Promise<void> {
  await db.insert(aiReportsTable).values({
    summary: report.summary,
    highlights: report.highlights,
    risks: report.risks,
    generatedAt: report.generatedAt,
  });
  // Bounded history — prune anything beyond the newest 20 reports.
  await db.execute(sql`
    DELETE FROM ai_reports
    WHERE id NOT IN (SELECT id FROM ai_reports ORDER BY generated_at DESC, id DESC LIMIT 20)
  `);
}

/** Load the newest persisted report (or null when none exists yet). */
async function loadLatestReportFromDb(): Promise<AiReport | null> {
  const [row] = await db
    .select()
    .from(aiReportsTable)
    .orderBy(desc(aiReportsTable.generatedAt), desc(aiReportsTable.id))
    .limit(1);
  if (!row) return null;
  return {
    summary: row.summary,
    highlights: row.highlights,
    risks: row.risks,
    generatedAt: row.generatedAt,
  };
}

/**
 * Resolve the latest report: memory → database → (optionally) generate fresh.
 * Generation persists the new report before returning it.
 */
export async function getLatestReport(opts: { generateIfMissing: boolean }): Promise<AiReport | null> {
  if (latestReport) return latestReport;
  const fromDb = await loadLatestReportFromDb();
  if (fromDb) {
    latestReport = fromDb;
    return fromDb;
  }
  if (!opts.generateIfMissing) return null;
  return generateAndStoreReport();
}

/** Generate a fresh report, persist it, and update the in-memory cache. */
export async function generateAndStoreReport(): Promise<AiReport> {
  const report = await generateReport();
  await persistReport(report);
  latestReport = report;
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Push failure alerting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a one-shot failure alert email when an orchestrator push fails.
 * Called from outbound-failure paths and from the echo handler on a
 * "failed" status echo. Never throws — a notification failure must not
 * affect the calling operation.
 */
async function alertPushFailure(params: {
  pushId: string;
  /** "outbound" = delivery to orchestrator failed; "echo" = orchestrator reported failure. */
  trigger: "outbound" | "echo";
  payloadType?: string;
  message: string;
}): Promise<void> {
  const { pushId, trigger, payloadType, message } = params;
  const subject =
    trigger === "outbound"
      ? `⚠️ AI orchestrator push failed — outbound delivery error`
      : `⚠️ AI orchestrator reported a failure for push ${pushId}`;
  const text = [
    trigger === "outbound"
      ? "A push to the AI orchestrator failed to deliver."
      : "The AI orchestrator reported a failure for a previously delivered push.",
    "",
    `Push ID:  ${pushId}`,
    ...(payloadType ? [`Payload:  ${payloadType}`] : []),
    `Error:    ${message}`,
    "",
    "View the full push history on the AI Monitor page in ProjectHub.",
  ].join("\n");

  try {
    await sendViaResend({
      from: "ProjectHub <notifications@contacts.ucfilters.com>",
      to: "info@ucfilters.com",
      subject,
      text,
      meta: { template: "push_failure_alert" },
    });
  } catch (err) {
    console.error("[ai/push] push-failure alert email threw:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Push recording — shared by the manual route and the daily scheduler job
// ─────────────────────────────────────────────────────────────────────────────

export interface PushOutcome {
  success: boolean;
  message: string;
  sentAt: Date;
  webhookUrl: string;
  pushId: string;
}

/**
 * Push a report to the Ultra Clear AI orchestrator, durably recording the
 * attempt in ai_push_events. The recorded row id is sent to the orchestrator
 * as `pushId`; it references it when calling back POST /api/ai/echo with a
 * status update (HMAC-signed, same scheme as /webhook/ingest).
 *
 * Every attempt is recorded — including when the webhook URL is not
 * configured (status "not_configured") — so the history board reflects
 * exactly what happened.
 */
export async function pushReportToOrchestrator(opts: {
  report: AiReport;
  trigger: "manual" | "scheduled";
  payloadType: "project_status_report" | "daily_project_status_report";
}): Promise<PushOutcome> {
  const webhookUrl = process.env.AI_ORCHESTRATOR_WEBHOOK_URL;
  const sentAt = new Date();

  // Record the push first so the payload can carry its durable id.
  const [event] = await db
    .insert(aiPushEventsTable)
    .values({
      payloadType: opts.payloadType,
      trigger: opts.trigger,
      target: webhookUrl ?? "(not configured)",
      sentAt,
      status: "pending",
    })
    .returning({ id: aiPushEventsTable.id });
  const pushId = event.id;

  // Finalize the outbound attempt WITHOUT clobbering an orchestrator echo.
  // The orchestrator may legitimately POST a signed echo while still handling
  // the outbound request — before its webhook response settles — moving the
  // row past "pending". Outbound fields are always recorded, but status /
  // statusDetail / statusUpdatedAt only advance while the row is still
  // "pending" (single atomic UPDATE; CASE expressions read the pre-update row
  // values, so an already-applied echo always wins).
  const finalize = async (fields: {
    outboundOk: boolean;
    outboundMessage: string;
    status: string;
    statusDetail: string;
  }) => {
    await db
      .update(aiPushEventsTable)
      .set({
        outboundOk: fields.outboundOk,
        outboundMessage: fields.outboundMessage,
        status: sql`CASE WHEN ${aiPushEventsTable.status} = 'pending' THEN ${fields.status} ELSE ${aiPushEventsTable.status} END`,
        statusDetail: sql`CASE WHEN ${aiPushEventsTable.status} = 'pending' THEN ${fields.statusDetail} ELSE ${aiPushEventsTable.statusDetail} END`,
        statusUpdatedAt: sql`CASE WHEN ${aiPushEventsTable.status} = 'pending' THEN now() ELSE ${aiPushEventsTable.statusUpdatedAt} END`,
      })
      .where(eq(aiPushEventsTable.id, pushId));
  };

  if (!webhookUrl) {
    const message =
      "AI_ORCHESTRATOR_WEBHOOK_URL not set — report generated but not sent. Set this env var to enable automatic push to Ultra Clear AI.";
    await finalize({
      outboundOk: false,
      outboundMessage: "Webhook URL not configured",
      status: "not_configured",
      statusDetail: message,
    });
    return { success: true, message, sentAt, webhookUrl: "(not configured)", pushId };
  }

  const payload = {
    source: "projecthub",
    type: opts.payloadType,
    // Durable push id — reference it in status echoes to POST /api/ai/echo.
    pushId,
    report: opts.report,
  };

  try {
    const secret = process.env.PROJECTHUB_WEBHOOK_SECRET;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // X-Requested-With is required by some orchestration webhooks (e.g.
        // Team-Horizon) that use it as a lightweight CSRF guard on their end.
        "X-Requested-With": "XMLHttpRequest",
        ...(secret ? { "Authorization": `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
    }

    const message = `Successfully pushed to Ultra Clear AI (${response.status})`;
    await finalize({
      outboundOk: true,
      outboundMessage: `HTTP ${response.status}`,
      status: "sent",
      statusDetail: "Delivered — awaiting orchestrator acknowledgment",
    });
    return { success: true, message, sentAt, webhookUrl, pushId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await finalize({
      outboundOk: false,
      outboundMessage: message,
      status: "failed",
      statusDetail: `Outbound delivery failed: ${message}`,
    });
    // Alert the team once — outbound delivery failed for this push id.
    await alertPushFailure({
      pushId,
      trigger: "outbound",
      payloadType: opts.payloadType,
      message,
    });
    return { success: false, message: `Push failed: ${message}`, sentAt, webhookUrl, pushId };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/push-task — dispatch a single task to an agent via orchestrator
// (team-auth applied in index.ts)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/push-task", requireTeamAuth, async (req, res): Promise<void> => {
  const { taskId, agentId, agentName } = req.body as {
    taskId?: number;
    agentId?: number;
    agentName?: string;
  };

  // Validate required fields
  if (!taskId || typeof taskId !== "number") {
    res.status(400).json({ error: "taskId (number) is required" });
    return;
  }
  if (!agentId && !agentName?.trim()) {
    res.status(400).json({ error: "agentId or agentName is required" });
    return;
  }

  // Fetch the task row
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const webhookUrl = process.env.AI_ORCHESTRATOR_WEBHOOK_URL;
  const secret = process.env.PROJECTHUB_WEBHOOK_SECRET;

  // Fail closed: both the webhook URL and the shared secret must be configured.
  // Without the secret there is no authenticated delivery path — the request
  // would go unsigned, which contradicts the HMAC signing contract and mirrors
  // how the inbound /api/ai/echo endpoint fails when the secret is absent.
  if (!webhookUrl) {
    res.status(503).json({
      error:
        "AI_ORCHESTRATOR_WEBHOOK_URL is not configured — task cannot be dispatched. Set this env var to enable agent dispatch.",
    });
    return;
  }
  if (!secret) {
    res.status(503).json({
      error:
        "PROJECTHUB_WEBHOOK_SECRET is not configured — task dispatch requires a shared secret for HMAC signing. Configure this env var to enable agent dispatch.",
    });
    return;
  }

  const sentAt = new Date();
  const payloadType = "task_dispatch";
  const trigger = "manual";

  // Record the push event first so the payload can carry its durable id
  const [event] = await db
    .insert(aiPushEventsTable)
    .values({
      payloadType,
      trigger,
      target: webhookUrl,
      sentAt,
      status: "pending",
      targetAgent: agentName?.trim() || null,
      taskTitle: task.title,
    })
    .returning({ id: aiPushEventsTable.id });
  const pushId = event.id;

  const finalize = async (fields: {
    outboundOk: boolean;
    outboundMessage: string;
    status: string;
    statusDetail: string;
  }) => {
    await db
      .update(aiPushEventsTable)
      .set({
        outboundOk: fields.outboundOk,
        outboundMessage: fields.outboundMessage,
        status: sql`CASE WHEN ${aiPushEventsTable.status} = 'pending' THEN ${fields.status} ELSE ${aiPushEventsTable.status} END`,
        statusDetail: sql`CASE WHEN ${aiPushEventsTable.status} = 'pending' THEN ${fields.statusDetail} ELSE ${aiPushEventsTable.statusDetail} END`,
        statusUpdatedAt: sql`CASE WHEN ${aiPushEventsTable.status} = 'pending' THEN now() ELSE ${aiPushEventsTable.statusUpdatedAt} END`,
      })
      .where(eq(aiPushEventsTable.id, pushId));
  };

  const payload = {
    source: "projecthub",
    type: payloadType,
    pushId,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      dueDate: task.dueDate,
      sourcePlatform: task.sourcePlatform,
      resourceRequired: task.resourceRequired,
      deliveryFormat: task.deliveryFormat,
      notifyVia: task.notifyVia,
      targetAgent: agentName ?? null,
      targetAgentId: agentId ?? null,
    },
  };

  try {
    const body = JSON.stringify(payload);

    // Compute outbound HMAC-SHA256 signature over the request body so the
    // receiving orchestrator can verify authenticity using the same shared
    // secret that secures the inbound /api/ai/echo callback.
    // `secret` is guaranteed non-null here (checked above).
    const hmacSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Authorization: `Bearer ${secret}`,
        "X-Webhook-Signature": hmacSig,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
    }

    await finalize({
      outboundOk: true,
      outboundMessage: `HTTP ${response.status}`,
      status: "sent",
      statusDetail: "Delivered — awaiting orchestrator acknowledgment",
    });
    res.json({
      success: true,
      message: `Task dispatched to orchestrator (${response.status})`,
      sentAt,
      webhookUrl,
      pushId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await finalize({
      outboundOk: false,
      outboundMessage: message,
      status: "failed",
      statusDetail: `Outbound delivery failed: ${message}`,
    });
    // Alert the team once — outbound task-dispatch delivery failed.
    await alertPushFailure({
      pushId,
      trigger: "outbound",
      payloadType,
      message,
    });
    res.status(502).json({ error: `Dispatch failed: ${message}`, pushId });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Inbound webhook: Ultra Clear AI Orchestrator asks a question
// POST /api/ai/query
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/query", async (req, res): Promise<void> => {
  const parsed = AiQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const systemPrompt = await buildProjectContext();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: parsed.data.question }],
    });

    const block = message.content[0];
    const answer = block.type === "text" ? block.text : "(no text response)";

    res.json(
      AiQueryResponse.parse({
        answer,
        generatedAt: new Date(),
        source: parsed.data.source ?? "unknown",
      }),
    );
  } catch (err) {
    console.error("[ai/query] Claude error:", err);
    res.status(500).json({ error: "Failed to generate AI response" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/report — return the latest report (memory → DB → generate)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/ai/report", requireTeamAuth, async (_req, res): Promise<void> => {
  try {
    const report = await getLatestReport({ generateIfMissing: true });
    res.json(GetAiReportResponse.parse(report));
  } catch (err) {
    console.error("[ai/report GET] generation error:", err);
    res.status(503).json({ error: "Report not yet available" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/report — force-generate a fresh report
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/report", requireTeamAuth, async (_req, res): Promise<void> => {
  try {
    const report = await generateAndStoreReport();
    res.json(GenerateAiReportResponse.parse(report));
  } catch (err) {
    console.error("[ai/report POST] generation error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/push — manually push summary to Ultra Clear AI orchestrator
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/push", requireTeamAuth, async (_req, res): Promise<void> => {
  try {
    const report = await getLatestReport({ generateIfMissing: true });
    if (!report) throw new Error("No report available");

    const outcome = await pushReportToOrchestrator({
      report,
      trigger: "manual",
      payloadType: "project_status_report",
    });

    res.json(PushToOrchestratorResponse.parse(outcome));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.json(
      PushToOrchestratorResponse.parse({
        success: false,
        message: `Push failed: ${message}`,
        sentAt: new Date(),
        webhookUrl: process.env.AI_ORCHESTRATOR_WEBHOOK_URL ?? "(not configured)",
      }),
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/pushes — push history board (team-only, newest first)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/ai/pushes", requireTeamAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiPushEventsTable)
    .orderBy(desc(aiPushEventsTable.sentAt))
    .limit(50);

  res.json(
    ListAiPushEventsResponse.parse(
      rows.map((r) => ({
        ...r,
        lastEchoAt: r.lastEchoAt ?? undefined,
        targetAgent: r.targetAgent ?? undefined,
        taskTitle: r.taskTitle ?? undefined,
      })),
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/echo — inbound status callback ("echo") from the orchestrator.
//
// Secured exactly like /webhook/ingest: HMAC-SHA256 over the raw request body,
// signature in X-Webhook-Signature ("sha256=<hex>" or bare hex), keyed by
// PROJECTHUB_WEBHOOK_SECRET. Rejects when the secret is not configured so
// there is never an unauthenticated processing path.
//
// Contract (documented on the AI Monitor page):
//   POST /api/ai/echo
//   { "pushId": "<uuid from the pushed payload>",
//     "status": "received" | "processing" | "completed" | "failed",
//     "message": "optional human-readable detail" }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/echo", async (req, res): Promise<void> => {
  const secret = process.env["PROJECTHUB_WEBHOOK_SECRET"];
  if (!secret) {
    console.error(
      "[ai/echo] PROJECTHUB_WEBHOOK_SECRET is not set — rejecting request. " +
        "Configure the secret to enable orchestrator status callbacks.",
    );
    res.status(503).json({
      error: "Status callbacks are not available: webhook secret is not configured.",
    });
    return;
  }

  // Use the exact raw bytes captured by the middleware in app.ts — do NOT fall
  // back to re-serialising req.body (key order / whitespace may differ from
  // the sender's bytes, which would fail the HMAC for legitimate requests).
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Raw body unavailable for signature check" });
    return;
  }

  const sig = req.headers["x-webhook-signature"] as string | undefined;
  if (!verifyEchoSignature(rawBody, sig, secret)) {
    res.status(401).json({ error: "Invalid or missing webhook signature" });
    return;
  }

  const parsed = AiPushEchoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { pushId, status, message } = parsed.data;
  const now = new Date();

  // Fetch current status before updating so we can detect a transition to
  // "failed" and alert the team exactly once per push (not on every echo).
  const [existing] = await db
    .select({ status: aiPushEventsTable.status, payloadType: aiPushEventsTable.payloadType })
    .from(aiPushEventsTable)
    .where(eq(aiPushEventsTable.id, pushId));

  const [updated] = await db
    .update(aiPushEventsTable)
    .set({
      status,
      statusDetail: message ?? "",
      statusUpdatedAt: now,
      lastEchoAt: now,
    })
    .where(eq(aiPushEventsTable.id, pushId))
    .returning({ id: aiPushEventsTable.id });

  if (!updated) {
    res.status(404).json({ error: "Unknown push id" });
    return;
  }

  req.log?.info({ pushId, status }, "Orchestrator echo applied to push event");

  // Alert the team when the orchestrator reports a failure — but only when
  // this is a new failure (previous status was not already "failed") so
  // repeated "failed" echoes for the same push don't spam the inbox.
  if (status === "failed" && existing?.status !== "failed") {
    await alertPushFailure({
      pushId,
      trigger: "echo",
      payloadType: existing?.payloadType ?? undefined,
      message: message ?? "The orchestrator reported a failure for this push.",
    });
  }

  res.json(AiPushEchoResponse.parse({ ok: true, pushId, status }));
});

/** Verify X-Webhook-Signature header using HMAC-SHA256 over the raw body. */
function verifyEchoSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  // Accept "sha256=<hex>" or bare hex
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: generate a structured AI report from live project data
// ─────────────────────────────────────────────────────────────────────────────
export async function generateReport(): Promise<AiReport> {
  const systemPrompt = await buildProjectContext();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Generate a concise project status report for the team. Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "summary": "2-3 sentence executive summary of overall project health",
  "highlights": ["up to 4 positive highlights or wins"],
  "risks": ["up to 4 risks, blockers, or items needing attention"]
}`,
      },
    ],
  });

  const block = message.content[0];
  const raw = block.type === "text" ? block.text : "{}";

  let parsed: { summary: string; highlights: string[]; risks: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: extract JSON from possible prose wrapping
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : { summary: raw, highlights: [], risks: [] };
  }

  return {
    summary: parsed.summary ?? "",
    highlights: parsed.highlights ?? [],
    risks: parsed.risks ?? [],
    generatedAt: new Date(),
  };
}

export { latestReport };
/**
 * Set (or clear) the in-memory report cache. Tests use setLatestReport(null)
 * to simulate an API restart — the persisted ai_reports row must then be
 * served without regeneration.
 */
export function setLatestReport(r: AiReport | null) {
  latestReport = r;
}

export default router;
