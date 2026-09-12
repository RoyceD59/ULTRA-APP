/**
 * Endpoint tests for POST /api/ai/push-task
 *
 * Covers:
 *   1. Auth rejection — 401 without a team-session JWT
 *   2. Validation — 400 when taskId is missing
 *   3. Validation — 400 when both agentId and agentName are absent
 *   4. Not configured — 503 when AI_ORCHESTRATOR_WEBHOOK_URL is unset
 *   5. Task not found — 404 for an unknown taskId
 *   6. Successful dispatch — 200 + ai_push_events row + outbound HMAC signature
 *   7. Failed dispatch — durable failed row remains visible on the Push Board
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { db, projectsTable, tasksTable, aiPushEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

// ── Minimal fetch wrapper ─────────────────────────────────────────────────────
async function apiFetch(
  path: string,
  init: RequestInit & { server: http.Server },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { server, ...options } = init;
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, options);
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

// ── Team-session token ────────────────────────────────────────────────────────
function teamAuthHeader() {
  const token = issueToken({
    id: 1,
    email: "admin@test.internal",
    name: "Test Admin",
    type: "team-session",
    role: "admin",
  });
  return `Bearer ${token}`;
}

// ── Server lifecycle ──────────────────────────────────────────────────────────
let server: http.Server;
let testProjectId: number;
let testTaskId: number;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-push-task";
  // Ensure webhook URL is unset for the "not configured" tests (the individual
  // tests that need it will set it temporarily in their own scope).
  delete process.env["AI_ORCHESTRATOR_WEBHOOK_URL"];

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });

  // Seed a project + task used by dispatch tests.
  const [proj] = await db
    .insert(projectsTable)
    .values({ name: "Push Task Test Project", description: "", status: "planning" })
    .returning({ id: projectsTable.id });
  testProjectId = proj.id;

  const [task] = await db
    .insert(tasksTable)
    .values({
      projectId: testProjectId,
      title: "Test dispatch task",
      description: "Created by push-task.test.ts",
      status: "todo",
      priority: "medium",
    })
    .returning({ id: tasksTable.id });
  testTaskId = task.id;
});

after(async () => {
  // Clean up seeded rows
  await db.delete(tasksTable).where(eq(tasksTable.id, testTaskId));
  await db.delete(projectsTable).where(eq(projectsTable.id, testProjectId));
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/ai/push-task", () => {
  it("rejects requests with no auth header (401)", async () => {
    const r = await apiFetch("/api/ai/push-task", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: testTaskId, agentName: "Orchestrator" }),
    });
    assert.equal(r.status, 401);
  });

  it("returns 400 when taskId is missing", async () => {
    const r = await apiFetch("/api/ai/push-task", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: teamAuthHeader() },
      body: JSON.stringify({ agentName: "Orchestrator" }),
    });
    assert.equal(r.status, 400);
    assert.ok(
      typeof r.body.error === "string" && r.body.error.includes("taskId"),
      `expected error about taskId, got: ${JSON.stringify(r.body)}`,
    );
  });

  it("returns 400 when both agentId and agentName are absent", async () => {
    const r = await apiFetch("/api/ai/push-task", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: teamAuthHeader() },
      body: JSON.stringify({ taskId: testTaskId }),
    });
    assert.equal(r.status, 400);
    assert.ok(
      typeof r.body.error === "string" &&
        (r.body.error.includes("agentId") || r.body.error.includes("agent")),
      `expected error about agent, got: ${JSON.stringify(r.body)}`,
    );
  });

  it("returns 503 when AI_ORCHESTRATOR_WEBHOOK_URL is not configured", async () => {
    delete process.env["AI_ORCHESTRATOR_WEBHOOK_URL"];
    delete process.env["PROJECTHUB_WEBHOOK_SECRET"];
    const r = await apiFetch("/api/ai/push-task", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: teamAuthHeader() },
      body: JSON.stringify({ taskId: testTaskId, agentName: "Orchestrator" }),
    });
    assert.equal(r.status, 503);
    assert.ok(
      typeof r.body.error === "string",
      `expected error field, got: ${JSON.stringify(r.body)}`,
    );
    // Must NOT report success — the task was not dispatched
    assert.ok(
      r.body.success !== true,
      "success must not be true when webhook is not configured",
    );
  });

  it("returns 503 and makes no outbound request when PROJECTHUB_WEBHOOK_SECRET is absent", async () => {
    // Provide a webhook URL but no secret — must fail closed, not send unsigned
    const mockServer = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const { port } = mockServer.address() as { port: number };
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = `http://127.0.0.1:${port}`;
    delete process.env["PROJECTHUB_WEBHOOK_SECRET"];

    let requestReceived = false;
    mockServer.on("request", () => { requestReceived = true; });

    try {
      const r = await apiFetch("/api/ai/push-task", {
        server,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: teamAuthHeader() },
        body: JSON.stringify({ taskId: testTaskId, agentName: "Orchestrator" }),
      });
      assert.equal(r.status, 503, `expected 503, got ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(typeof r.body.error === "string", "must return error message");
      assert.ok(r.body.success !== true, "success must not be true");
      assert.equal(requestReceived, false, "no outbound request must be made when secret is absent");
    } finally {
      delete process.env["AI_ORCHESTRATOR_WEBHOOK_URL"];
      await new Promise<void>((resolve, reject) =>
        mockServer.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it("returns 404 for an unknown taskId", async () => {
    // Temporarily set a webhook URL pointing at a local mock so the endpoint
    // can proceed past the "not configured" guard.
    const mockServer = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const { port } = mockServer.address() as { port: number };
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = `http://127.0.0.1:${port}`;

    try {
      const r = await apiFetch("/api/ai/push-task", {
        server,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: teamAuthHeader() },
        body: JSON.stringify({ taskId: 999_999_999, agentName: "Orchestrator" }),
      });
      assert.equal(r.status, 404);
    } finally {
      delete process.env["AI_ORCHESTRATOR_WEBHOOK_URL"];
      await new Promise<void>((resolve, reject) =>
        mockServer.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it("dispatches successfully, records ai_push_events row, and sends HMAC signature", async () => {
    const secret = "test-webhook-secret-push-task";
    process.env["PROJECTHUB_WEBHOOK_SECRET"] = secret;

    // Capture the inbound request from the API server
    let capturedBody = "";
    let capturedSignature = "";
    const mockServer = http.createServer((req, res) => {
      let data = "";
      req.on("data", (chunk: Buffer) => (data += chunk.toString()));
      req.on("end", () => {
        capturedBody = data;
        capturedSignature = (req.headers["x-webhook-signature"] as string) ?? "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const { port } = mockServer.address() as { port: number };
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = `http://127.0.0.1:${port}`;

    try {
      const r = await apiFetch("/api/ai/push-task", {
        server,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: teamAuthHeader() },
        body: JSON.stringify({ taskId: testTaskId, agentId: 1, agentName: "Orchestrator" }),
      });

      assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.success, true);
      assert.ok(typeof r.body.pushId === "string" && r.body.pushId.length > 0);

      // Verify the ai_push_events row was recorded
      const [evtRow] = await db
        .select()
        .from(aiPushEventsTable)
        .where(eq(aiPushEventsTable.id, r.body.pushId as string))
        .limit(1);
      assert.ok(evtRow, "ai_push_events row must be created");
      assert.equal(evtRow.payloadType, "task_dispatch");
      assert.equal(evtRow.trigger, "manual");
      assert.equal(evtRow.outboundOk, true);
      assert.equal(evtRow.status, "sent");

      // Verify the outbound payload contains the task
      const outbound = JSON.parse(capturedBody) as Record<string, unknown>;
      assert.equal(outbound.type, "task_dispatch");
      assert.equal(outbound.source, "projecthub");
      assert.ok(outbound.task, "outbound payload must include task object");
      const taskObj = outbound.task as Record<string, unknown>;
      assert.equal(taskObj.id, testTaskId);
      assert.equal(taskObj.targetAgent, "Orchestrator");

      // Verify outbound HMAC-SHA256 signature
      assert.ok(
        capturedSignature.startsWith("sha256="),
        `X-Webhook-Signature must start with 'sha256=', got: ${capturedSignature}`,
      );
      const expectedSig =
        "sha256=" + createHmac("sha256", secret).update(capturedBody).digest("hex");
      assert.equal(capturedSignature, expectedSig, "HMAC signature must match body");

      // Clean up the event row
      await db
        .delete(aiPushEventsTable)
        .where(eq(aiPushEventsTable.id, r.body.pushId as string));
    } finally {
      delete process.env["AI_ORCHESTRATOR_WEBHOOK_URL"];
      delete process.env["PROJECTHUB_WEBHOOK_SECRET"];
      await new Promise<void>((resolve, reject) =>
        mockServer.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it("keeps a failed task dispatch visible on the Push Board with the same push id", async () => {
    const secret = "test-webhook-secret-push-task-failure";
    process.env["PROJECTHUB_WEBHOOK_SECRET"] = secret;

    const mockServer = http.createServer((_req, res) => {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("orchestrator unavailable");
    });
    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const { port } = mockServer.address() as { port: number };
    process.env["AI_ORCHESTRATOR_WEBHOOK_URL"] = `http://127.0.0.1:${port}`;

    let pushId: string | undefined;
    try {
      const dispatch = await apiFetch("/api/ai/push-task", {
        server,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: teamAuthHeader() },
        body: JSON.stringify({
          taskId: testTaskId,
          agentId: 1,
          agentName: "Failing Orchestrator",
        }),
      });

      assert.equal(
        dispatch.status,
        502,
        `expected failed dispatch response, got ${dispatch.status}: ${JSON.stringify(dispatch.body)}`,
      );
      assert.ok(
        typeof dispatch.body.pushId === "string" && dispatch.body.pushId.length > 0,
        "failed dispatch response must include its durable push id",
      );
      pushId = dispatch.body.pushId as string;

      const pushes = await apiFetch("/api/ai/pushes", {
        server,
        method: "GET",
        headers: { Authorization: teamAuthHeader() },
      });

      assert.equal(pushes.status, 200);
      assert.ok(Array.isArray(pushes.body), "Push Board response must be an array");
      const matchingPush = (pushes.body as unknown as Array<Record<string, unknown>>)
        .find((push) => push.id === pushId);
      assert.ok(matchingPush, "failed task dispatch must remain visible on the Push Board");
      assert.equal(matchingPush.payloadType, "task_dispatch");
      assert.equal(matchingPush.status, "failed");
      assert.equal(matchingPush.id, pushId);
      assert.equal(matchingPush.outboundOk, false);
    } finally {
      delete process.env["AI_ORCHESTRATOR_WEBHOOK_URL"];
      delete process.env["PROJECTHUB_WEBHOOK_SECRET"];
      if (pushId) {
        await db.delete(aiPushEventsTable).where(eq(aiPushEventsTable.id, pushId));
      }
      await new Promise<void>((resolve, reject) =>
        mockServer.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
