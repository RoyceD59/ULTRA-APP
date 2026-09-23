/**
 * AI Monitor push durability + orchestrator status echo tests.
 *
 * Covers:
 *  1. Push-event recording — manual pushes create durable ai_push_events rows
 *     and the outbound payload carries the row's pushId.
 *  2. Echo signature enforcement — missing / invalid / valid HMAC signatures
 *     on POST /api/ai/echo (same scheme as /webhook/ingest).
 *  3. Status transitions — received → processing → completed applied to the
 *     stored push record; unknown pushId → 404.
 *  4. Report survival across a simulated restart — the in-memory cache is
 *     cleared and GET /api/ai/report must serve the persisted report without
 *     regenerating (no Anthropic credentials exist in the test env, so any
 *     regeneration attempt would fail loudly).
 *  5. Scheduled pushes are recorded in the same history (trigger=scheduled).
 *
 * The suite runs inside the isolated per-run test database (src/tests/run.ts).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";

process.env["SESSION_SECRET"] ??= "test-secret-ai-push-echo";
process.env["PROJECTHUB_WEBHOOK_SECRET"] = "test-echo-secret";

import { issueToken } from "../lib/jwt.js";
import app from "../app.js";
import {
  db,
  aiReportsTable,
  aiPushEventsTable,
  ucNotificationLogTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  setLatestReport,
  pushReportToOrchestrator,
} from "../routes/ai/monitor.js";

const ECHO_SECRET = "test-echo-secret";

let server: http.Server;
let base: string;
let authToken: string;

// Stub orchestrator webhook — records received payloads. When echoBeforeReply
// is set, it POSTs a signed echo BACK to the app before answering the
// outbound push request (the overlapping-echo race).
let orchestrator: http.Server;
let orchestratorUrl: string;
let receivedPayloads: unknown[] = [];
let echoBeforeReply = false;

const SEED_REPORT = {
  summary: "Seeded report — must survive restarts.",
  highlights: ["Highlight A", "Highlight B"],
  risks: ["Risk A"],
  generatedAt: new Date("2026-08-15T06:00:00Z"),
};

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", ECHO_SECRET).update(body).digest("hex");
}

async function postEcho(body: string, signature?: string) {
  return fetch(`${base}/api/ai/echo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "X-Webhook-Signature": signature } : {}),
    },
    body,
  });
}

before(async () => {
  // Stub orchestrator endpoint
  await new Promise<void>((resolve) => {
    orchestrator = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const payload = JSON.parse(raw) as { pushId?: string };
        receivedPayloads.push(payload);
        if (echoBeforeReply && payload.pushId) {
          // Echo a terminal status while the outbound request is still open.
          const body = JSON.stringify({
            pushId: payload.pushId,
            status: "completed",
            message: "Processed synchronously",
          });
          const echoRes = await postEcho(body, sign(body));
          if (echoRes.status !== 200) {
            console.error("stub orchestrator: overlapping echo rejected", echoRes.status);
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    orchestrator.listen(0, "127.0.0.1", () => {
      const addr = orchestrator.address();
      if (typeof addr === "object" && addr) orchestratorUrl = `http://127.0.0.1:${addr.port}/webhook`;
      resolve();
    });
  });

  // App under test
  await new Promise<void>((resolve) => {
    const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    authToken = issueToken({
      id: "test-admin", email: "test@ucfilters.com", name: "Test Admin",
      type: "team-session", role: "admin", exp,
    });
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) base = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // Seed a persisted report so no route ever needs to call Anthropic.
  await db.insert(aiReportsTable).values(SEED_REPORT);
  setLatestReport(null);
});

after(async () => {
  await db.delete(aiPushEventsTable);
  await db.delete(aiReportsTable);
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => orchestrator.close(() => r()));
});

describe("report survival across a simulated restart", () => {
  it("GET /api/ai/report serves the persisted report after the in-memory cache is wiped", async () => {
    setLatestReport(null); // simulate API restart
    const res = await fetch(`${base}/api/ai/report`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { summary: string; highlights: string[]; risks: string[] };
    assert.equal(body.summary, SEED_REPORT.summary);
    assert.deepEqual(body.highlights, SEED_REPORT.highlights);
    assert.deepEqual(body.risks, SEED_REPORT.risks);
  });
});

describe("push event recording", () => {
  it("manual push records a durable event and sends pushId to the orchestrator", async () => {
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = orchestratorUrl;
    receivedPayloads = [];

    const res = await fetch(`${base}/api/ai/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { success: boolean; pushId?: string };
    assert.equal(body.success, true);
    assert.ok(body.pushId, "response must include the durable pushId");

    // Row persisted with outbound result
    const [row] = await db
      .select()
      .from(aiPushEventsTable)
      .where(eq(aiPushEventsTable.id, body.pushId!));
    assert.ok(row, "ai_push_events row must exist");
    assert.equal(row.trigger, "manual");
    assert.equal(row.payloadType, "project_status_report");
    assert.equal(row.outboundOk, true);
    assert.equal(row.status, "sent");
    assert.equal(row.target, orchestratorUrl);

    // Outbound payload carried the same pushId + the report
    assert.equal(receivedPayloads.length, 1);
    const payload = receivedPayloads[0] as { pushId: string; type: string; report: { summary: string } };
    assert.equal(payload.pushId, body.pushId);
    assert.equal(payload.type, "project_status_report");
    assert.equal(payload.report.summary, SEED_REPORT.summary);
  });

  it("outbound failure is recorded with status=failed", async () => {
    // Point at a port nothing listens on
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = "http://127.0.0.1:1/webhook";

    const res = await fetch(`${base}/api/ai/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { success: boolean; pushId?: string };
    assert.equal(body.success, false);
    assert.ok(body.pushId);

    const [row] = await db
      .select()
      .from(aiPushEventsTable)
      .where(eq(aiPushEventsTable.id, body.pushId!));
    assert.equal(row.outboundOk, false);
    assert.equal(row.status, "failed");
  });

  it("push without a configured webhook is still recorded (status=not_configured)", async () => {
    delete process.env["AI_ORCHESTRATOR_WEBHOOK_URL"];

    const res = await fetch(`${base}/api/ai/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const body = await res.json() as { success: boolean; pushId?: string };
    assert.equal(body.success, true);
    assert.ok(body.pushId);

    const [row] = await db
      .select()
      .from(aiPushEventsTable)
      .where(eq(aiPushEventsTable.id, body.pushId!));
    assert.equal(row.status, "not_configured");
    assert.equal(row.target, "(not configured)");
  });

  it("an echo arriving before the outbound response settles wins over the outbound finalizer", async () => {
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = orchestratorUrl;
    echoBeforeReply = true;
    try {
      const res = await fetch(`${base}/api/ai/push`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { success: boolean; pushId?: string };
      assert.equal(body.success, true);
      assert.ok(body.pushId);

      const [row] = await db
        .select()
        .from(aiPushEventsTable)
        .where(eq(aiPushEventsTable.id, body.pushId!));
      // The echoed terminal status must survive the outbound finalizer …
      assert.equal(row.status, "completed");
      assert.equal(row.statusDetail, "Processed synchronously");
      assert.ok(row.lastEchoAt, "echo timestamp must be recorded");
      // … while the outbound result is still recorded on the same row.
      assert.equal(row.outboundOk, true);
      assert.equal(row.outboundMessage, "HTTP 200");
    } finally {
      echoBeforeReply = false;
    }
  });

  it("scheduled pushes are recorded in the same history", async () => {
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = orchestratorUrl;
    const outcome = await pushReportToOrchestrator({
      report: SEED_REPORT,
      trigger: "scheduled",
      payloadType: "daily_project_status_report",
    });
    assert.equal(outcome.success, true);

    const [row] = await db
      .select()
      .from(aiPushEventsTable)
      .where(eq(aiPushEventsTable.id, outcome.pushId));
    assert.equal(row.trigger, "scheduled");
    assert.equal(row.payloadType, "daily_project_status_report");
    assert.equal(row.status, "sent");
  });

  it("GET /api/ai/pushes requires team auth and lists events newest first", async () => {
    const unauth = await fetch(`${base}/api/ai/pushes`);
    assert.equal(unauth.status, 401);

    const res = await fetch(`${base}/api/ai/pushes`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const list = await res.json() as { sentAt: string }[];
    assert.ok(list.length >= 4);
    for (let i = 1; i < list.length; i++) {
      assert.ok(new Date(list[i - 1].sentAt) >= new Date(list[i].sentAt), "must be newest first");
    }
  });
});

describe("echo signature enforcement", () => {
  let pushId: string;

  before(async () => {
    const [row] = await db
      .insert(aiPushEventsTable)
      .values({
        payloadType: "project_status_report",
        trigger: "manual",
        target: "http://example.com",
        outboundOk: true,
        status: "sent",
      })
      .returning({ id: aiPushEventsTable.id });
    pushId = row.id;
  });

  it("rejects an unsigned echo", async () => {
    const res = await postEcho(JSON.stringify({ pushId, status: "received" }));
    assert.equal(res.status, 401);
  });

  it("rejects a wrongly-signed echo", async () => {
    const body = JSON.stringify({ pushId, status: "received" });
    const badSig = "sha256=" + createHmac("sha256", "wrong-secret").update(body).digest("hex");
    const res = await postEcho(body, badSig);
    assert.equal(res.status, 401);

    // Signature over DIFFERENT bytes must also fail
    const res2 = await postEcho(body, sign(body + " "));
    assert.equal(res2.status, 401);
  });

  it("accepts a correctly-signed echo and updates the push record", async () => {
    const body = JSON.stringify({ pushId, status: "received", message: "Queued for processing" });
    const res = await postEcho(body, sign(body));
    assert.equal(res.status, 200);
    const ack = await res.json() as { ok: boolean; pushId: string; status: string };
    assert.deepEqual(ack, { ok: true, pushId, status: "received" });

    const [row] = await db
      .select()
      .from(aiPushEventsTable)
      .where(eq(aiPushEventsTable.id, pushId));
    assert.equal(row.status, "received");
    assert.equal(row.statusDetail, "Queued for processing");
    assert.ok(row.lastEchoAt, "lastEchoAt must be set by an echo");
  });

  it("returns 404 for an unknown pushId", async () => {
    const body = JSON.stringify({ pushId: "00000000-0000-0000-0000-000000000000", status: "completed" });
    const res = await postEcho(body, sign(body));
    assert.equal(res.status, 404);
  });

  it("rejects an invalid status value", async () => {
    const body = JSON.stringify({ pushId, status: "exploded" });
    const res = await postEcho(body, sign(body));
    assert.equal(res.status, 400);
  });

  it("applies received → processing → completed transitions", async () => {
    for (const status of ["processing", "completed"] as const) {
      const body = JSON.stringify({ pushId, status, message: `Now ${status}` });
      const res = await postEcho(body, sign(body));
      assert.equal(res.status, 200);
      const [row] = await db
        .select()
        .from(aiPushEventsTable)
        .where(eq(aiPushEventsTable.id, pushId));
      assert.equal(row.status, status);
      assert.equal(row.statusDetail, `Now ${status}`);
    }
  });

  it("alerts once when a signed echo reports failure", async () => {
    const [seeded] = await db
      .insert(aiPushEventsTable)
      .values({
        payloadType: "project_status_report",
        trigger: "manual",
        target: "http://example.com/orchestrator",
        outboundOk: true,
        status: "sent",
      })
      .returning({ id: aiPushEventsTable.id });

    const alerts: Array<Record<string, unknown>> = [];
    const resendServer = http.createServer((req, res) => {
      let data = "";
      req.on("data", (chunk: Buffer) => (data += chunk.toString()));
      req.on("end", () => {
        alerts.push(JSON.parse(data) as Record<string, unknown>);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "push-failure-alert-echo" }));
      });
    });
    await new Promise<void>((resolve) => resendServer.listen(0, "127.0.0.1", resolve));
    const { port } = resendServer.address() as { port: number };
    process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${port}`;

    try {
      const body = JSON.stringify({
        pushId: seeded.id,
        status: "failed",
        message: "Orchestrator rejected the report",
      });

      const first = await postEcho(body, sign(body));
      assert.equal(first.status, 200);
      const repeated = await postEcho(body, sign(body));
      assert.equal(repeated.status, 200);

      assert.equal(alerts.length, 1, "repeated failed echoes must not send duplicate alerts");
      assert.equal(alerts[0].to, "info@ucfilters.com");
      assert.equal(
        alerts[0].subject,
        `⚠️ AI orchestrator reported a failure for push ${seeded.id}`,
      );
      assert.match(
        String(alerts[0].text),
        /The AI orchestrator reported a failure for a previously delivered push\./,
      );
      assert.match(String(alerts[0].text), /Error:\s+Orchestrator rejected the report/);

      const alertLogs = await db
        .select()
        .from(ucNotificationLogTable)
        .where(eq(ucNotificationLogTable.resendMessageId, "push-failure-alert-echo"));
      assert.equal(alertLogs.length, 1, "repeated failed echoes must create one alert log");
      assert.equal(alertLogs[0].template, "push_failure_alert");
    } finally {
      delete process.env["RESEND_BASE_URL"];
      await db
        .delete(ucNotificationLogTable)
        .where(eq(ucNotificationLogTable.resendMessageId, "push-failure-alert-echo"));
      await db.delete(aiPushEventsTable).where(eq(aiPushEventsTable.id, seeded.id));
      await new Promise<void>((resolve, reject) =>
        resendServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("task dispatch echo lifecycle", () => {
  it("advances a task_dispatch push through received → processing → completed", async () => {
    const [seeded] = await db
      .insert(aiPushEventsTable)
      .values({
        payloadType: "task_dispatch",
        trigger: "manual",
        target: "http://example.com/orchestrator",
        outboundOk: true,
        status: "sent",
        targetAgent: "Test Agent",
        taskTitle: "Verify task dispatch echo lifecycle",
      })
      .returning({ id: aiPushEventsTable.id });

    let previousEchoAt: Date | null = null;

    for (const status of ["received", "processing", "completed"] as const) {
      const body = JSON.stringify({
        pushId: seeded.id,
        status,
        message: `Task dispatch ${status}`,
      });
      const res = await postEcho(body, sign(body));
      assert.equal(res.status, 200);

      const [row] = await db
        .select()
        .from(aiPushEventsTable)
        .where(eq(aiPushEventsTable.id, seeded.id));
      assert.equal(row.payloadType, "task_dispatch");
      assert.equal(row.status, status);
      assert.equal(row.statusDetail, `Task dispatch ${status}`);
      assert.ok(row.lastEchoAt, `lastEchoAt must be set when status becomes ${status}`);
      assert.equal(
        row.lastEchoAt.getTime(),
        row.statusUpdatedAt.getTime(),
        "lastEchoAt and statusUpdatedAt must reflect the same echo",
      );
      if (previousEchoAt) {
        assert.ok(
          row.lastEchoAt.getTime() >= previousEchoAt.getTime(),
          `lastEchoAt must not move backwards when status becomes ${status}`,
        );
      }
      previousEchoAt = row.lastEchoAt;
    }
  });
});
