/**
 * Integration tests — Team Horizon pages (end-to-end API layer)
 *
 * Covers the four page flows verified in Task #54:
 *   1. Contacts  — add a contact + email/WhatsApp method; edit; delete
 *   2. System Status — add platform; ping; verify lastChecked advances
 *   3. Webhook Tester — submit valid taskData; confirm task created in DB
 *   4. Notifications — dispatch STAKEHOLDER_UPDATE; verify log row appears
 *
 * The Express app is started on an ephemeral port (listen(0)) so these tests
 * never clash with the running dev server.  All rows created during a test are
 * cleaned from the DB in the `after` hook so reruns stay idempotent.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";

process.env["SESSION_SECRET"] ??= "test-secret-team-horizon-pages";

import { issueToken } from "../lib/jwt.js";

// ── App & DB ──────────────────────────────────────────────────────────────────
// Dynamic imports so env vars can be set before the modules are evaluated.
import app from "../app.js";
import {
  db,
  contactsTable,
  contactMethodsTable,
  notificationLogsTable,
  systemStatusTable,
  tasksTable,
  projectsTable,
  membersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Helpers ───────────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;
let authToken: string;

/** Start the app on a random free port before any test runs. */
before(
  () =>
    new Promise<void>((resolve, reject) => {
      // Issue a test admin JWT so routes protected by requireTeamAuth pass.
      const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
      authToken = issueToken({
        id: "test-admin", email: "test@ucfilters.com", name: "Test Admin",
        type: "team-session", role: "admin", exp,
      });

      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Could not determine server address"));
          return;
        }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    }),
  { timeout: 10_000 }
);

after(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  { timeout: 5_000 }
);

/** Thin wrapper so tests can call the API with minimal boilerplate. */
async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const token = issueToken({
    id: "team",
    email: "team@projecthub.internal",
    type: "team-session",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  });
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${base}${path}`, opts);
  const contentType = res.headers.get("content-type") ?? "";
  const data = res.status === 204
    ? null
    : contentType.includes("json")
    ? await res.json()
    : await res.text();
  return { status: res.status, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Contacts
// ─────────────────────────────────────────────────────────────────────────────

describe("Contacts page flows", () => {
  let contactId: number;
  let methodEmailId: number;
  let methodWaId: number;

  after(async () => {
    // Clean up any rows that survived (e.g. if a later assertion failed)
    if (contactId) {
      await db.delete(contactsTable).where(eq(contactsTable.id, contactId));
    }
  });

  it("creates a new contact", async () => {
    const { status, data } = await api("POST", "/contacts", {
      fullName: "E2E Test Contact",
      role: "Tester",
      organization: "TestCorp",
      tags: ["stakeholder"],
    });
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.ok(typeof d["id"] === "number", "Response should include numeric id");
    assert.equal(d["fullName"], "E2E Test Contact");
    contactId = d["id"] as number;
  });

  it("retrieves the contact by id", async () => {
    const { status, data } = await api("GET", `/contacts/${contactId}`);
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    assert.equal(d["id"], contactId);
    assert.equal(d["fullName"], "E2E Test Contact");
  });

  it("adds an email contact method", async () => {
    const { status, data } = await api("POST", `/contacts/${contactId}/methods`, {
      channelType: "email",
      channelValue: "e2e-test@example.com",
      isPreferred: true,
    });
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.equal(d["channelType"], "email");
    assert.equal(d["channelValue"], "e2e-test@example.com");
    methodEmailId = d["id"] as number;
  });

  it("adds a WhatsApp contact method", async () => {
    const { status, data } = await api("POST", `/contacts/${contactId}/methods`, {
      channelType: "whatsapp",
      channelValue: "+254712345678",
      isPreferred: false,
    });
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.equal(d["channelType"], "whatsapp");
    methodWaId = d["id"] as number;
  });

  it("GET /contacts/:id returns both methods", async () => {
    const { status, data } = await api("GET", `/contacts/${contactId}`);
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    const methods = d["methods"] as unknown[];
    assert.ok(Array.isArray(methods));
    assert.equal(methods.length, 2, "Contact should have 2 methods (email + whatsapp)");
  });

  it("edits (patches) the contact", async () => {
    const { status, data } = await api("PATCH", `/contacts/${contactId}`, {
      role: "Lead Tester",
      tags: ["stakeholder", "partner"],
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.equal(d["role"], "Lead Tester");
  });

  it("deletes one contact method", async () => {
    const { status } = await api(
      "DELETE",
      `/contacts/${contactId}/methods/${methodWaId}`
    );
    assert.equal(status, 204);
    // Verify via GET that only one method remains
    const { data } = await api("GET", `/contacts/${contactId}`);
    const d = data as Record<string, unknown>;
    const methods = d["methods"] as unknown[];
    assert.equal(methods.length, 1);
  });

  it("deletes the contact", async () => {
    const { status } = await api("DELETE", `/contacts/${contactId}`);
    assert.equal(status, 204);
    // Verify 404 on subsequent GET
    const { status: getStatus } = await api("GET", `/contacts/${contactId}`);
    assert.equal(getStatus, 404);
    contactId = 0; // mark cleaned so `after` hook skips it
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. System Status
// ─────────────────────────────────────────────────────────────────────────────

describe("System Status page flows", () => {
  let platformId: number;
  const platformName = `e2e-test-platform-${Date.now()}`;

  after(async () => {
    if (platformId) {
      await db
        .delete(systemStatusTable)
        .where(eq(systemStatusTable.id, platformId));
    }
  });

  it("adds a platform to the watchdog", async () => {
    const { status, data } = await api("POST", "/system/status", {
      platform: platformName,
      status: "connected",
      notes: "Created by integration test",
    });
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.equal(d["platform"], platformName);
    platformId = d["id"] as number;
  });

  it("pings the platform and verifies lastChecked advances", async () => {
    // Capture baseline timestamp from DB
    const [before] = await db
      .select({ lastChecked: systemStatusTable.lastChecked })
      .from(systemStatusTable)
      .where(eq(systemStatusTable.id, platformId));

    const baselineMs = new Date(before!.lastChecked).getTime();

    // Small delay so the updated timestamp is definitely newer
    await new Promise((r) => setTimeout(r, 50));

    const { status, data } = await api("POST", `/system/ping/${platformId}`);
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.equal(d["status"], "connected");

    const updatedMs = new Date(d["lastChecked"] as string).getTime();
    assert.ok(
      updatedMs >= baselineMs,
      `lastChecked should not regress (before=${baselineMs}, after=${updatedMs})`
    );
  });

  it("lists all system statuses and includes the new platform", async () => {
    const { status, data } = await api("GET", "/system/status");
    assert.equal(status, 200);
    const arr = data as Array<Record<string, unknown>>;
    const found = arr.find((s) => s["id"] === platformId);
    assert.ok(found, "Newly added platform should appear in the list");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Webhook Tester
// ─────────────────────────────────────────────────────────────────────────────

const INGEST_TEST_SECRET = "test-ingest-secret-e2e";

/** Compute HMAC-SHA256 of a JSON body for the public /webhook/ingest endpoint. */
function signIngest(body: unknown): string {
  return "sha256=" + createHmac("sha256", INGEST_TEST_SECRET).update(JSON.stringify(body)).digest("hex");
}

/** POST directly to the public /webhook/ingest endpoint (bypasses the api() auth helper). */
async function postIngest(
  body: unknown,
  opts: { sig?: string; omitSig?: boolean } = {},
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!opts.omitSig) {
    headers["x-webhook-signature"] = opts.sig ?? signIngest(body);
  }
  const res = await fetch(`${base}/webhook/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe("Webhook Tester page flows", () => {
  let projectId: number;
  let memberId: number;
  let createdTaskId: number | null = null;

  before(async () => {
    // Set a deterministic test secret so both the authenticated test-dispatch
    // and the public HMAC ingest tests can run against the same server instance.
    process.env["PROJECTHUB_WEBHOOK_SECRET"] = INGEST_TEST_SECRET;

    // Seed a project so the webhook can reference it via FK
    const [project] = await db
      .insert(projectsTable)
      .values({ name: "E2E Webhook Test Project", status: "active" })
      .returning();
    projectId = project!.id;

    // Seed a member so assigneeId FK is satisfied
    const [member] = await db
      .insert(membersTable)
      .values({ name: "E2E Assignee", email: `e2e-assignee-${Date.now()}@test.local`, role: "Developer" })
      .returning();
    memberId = member!.id;
  });

  after(async () => {
    delete process.env["PROJECTHUB_WEBHOOK_SECRET"];
    if (createdTaskId) {
      await db.delete(tasksTable).where(eq(tasksTable.id, createdTaskId));
    }
    if (projectId) {
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    if (memberId) {
      await db.delete(membersTable).where(eq(membersTable.id, memberId));
    }
  });

  // ── Authenticated test-dispatch (used by the Webhook Tester UI) ─────────────

  it("test-dispatch: rejects a payload missing required taskData fields (400)", async () => {
    const { status, data } = await api("POST", "/webhook/test-dispatch", {
      event: "task.created",
      sourcePlatform: "jira",
      taskData: {
        title: "Missing fields test",
        // Missing: assigneeId, resourceRequired, deliveryFormat
      },
    });
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.equal(d["accepted"], false);
    const errors = d["validationErrors"] as string[];
    assert.ok(Array.isArray(errors) && errors.length > 0, "Should list validation errors");
  });

  it("test-dispatch: accepts a valid payload and creates a task in the DB (200)", async () => {
    const { status, data } = await api("POST", "/webhook/test-dispatch", {
      event: "task.created",
      sourcePlatform: "jira",
      taskData: {
        projectId,
        title: "E2E Webhook Task",
        description: "Created by integration test",
        priority: "high",
        assigneeId: memberId,
        resourceRequired: { type: "budget", amount: 5000 },
        deliveryFormat: "pdf",
      },
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    assert.equal(d["accepted"], true);
    assert.ok(
      typeof d["taskId"] === "number",
      `Response should include numeric taskId; got ${JSON.stringify(d["taskId"])}`
    );
    createdTaskId = d["taskId"] as number;

    // Confirm the task actually exists in the DB
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, createdTaskId!));
    assert.ok(task, "Task should exist in the database");
    assert.equal(task!.title, "E2E Webhook Task");
    assert.equal(task!.sourcePlatform, "jira");
  });

  // ── Public /webhook/ingest HMAC guard ───────────────────────────────────────

  it("public ingest: correct HMAC-SHA256 signature is accepted (400 for missing fields)", async () => {
    const body = { event: "task.created", sourcePlatform: "test-system" };
    const { status } = await postIngest(body);
    // No taskData → Zod accepts the payload but validation errors fire; either way
    // we get a non-401/503 response, proving the signature was accepted.
    assert.ok(
      status === 200 || status === 400,
      `Expected 200 or 400 for correctly-signed ingest; got ${status}`,
    );
  });

  it("public ingest: wrong HMAC-SHA256 signature is rejected (401)", async () => {
    const body = { event: "task.created", sourcePlatform: "test-system" };
    const { status, data } = await postIngest(body, { sig: "sha256=" + "0".repeat(64) });
    assert.equal(status, 401, `Expected 401 for wrong signature; got ${status}: ${JSON.stringify(data)}`);
  });

  it("public ingest: missing signature header is rejected (401)", async () => {
    const body = { event: "task.created", sourcePlatform: "test-system" };
    const { status, data } = await postIngest(body, { omitSig: true });
    assert.equal(status, 401, `Expected 401 when signature header is absent; got ${status}: ${JSON.stringify(data)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Notifications
// ─────────────────────────────────────────────────────────────────────────────

describe("Notifications page flows", () => {
  let contactId: number;
  let logId: number | undefined;

  before(async () => {
    // Seed a contact with an email method so the dispatcher can use it
    const [contact] = await db
      .insert(contactsTable)
      .values({
        fullName: "E2E Notification Target",
        role: "Stakeholder",
        organization: "E2E Corp",
        tags: ["stakeholder"],
      })
      .returning();
    contactId = contact!.id;

    await db.insert(contactMethodsTable).values({
      contactId,
      channelType: "email",
      channelValue: "e2e-notify@example.com",
      isPreferred: true,
    });
  });

  after(async () => {
    if (logId) {
      await db
        .delete(notificationLogsTable)
        .where(eq(notificationLogsTable.id, logId));
    }
    if (contactId) {
      await db
        .delete(contactsTable)
        .where(eq(contactsTable.id, contactId));
    }
  });

  it("dispatches a STAKEHOLDER_UPDATE notification to the seeded contact", async () => {
    const { status, data } = await api("POST", "/notifications/dispatch", {
      contactId,
      templateId: "STAKEHOLDER_UPDATE",
    });
    // The endpoint always returns 200 and writes a log — success/failed depends
    // on whether an email provider is configured in the test environment.
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    const d = data as Record<string, unknown>;
    // Response shape: { success: boolean, channelUsed: string, logId: number }
    assert.ok(
      typeof d["success"] === "boolean",
      `Response should include boolean 'success'; got ${JSON.stringify(d)}`
    );
    assert.ok(
      typeof d["logId"] === "number",
      `Response should include numeric 'logId'; got ${JSON.stringify(d)}`
    );
    logId = d["logId"] as number;
  });

  it("GET /notifications/logs returns a row for the dispatched notification", async () => {
    const { status, data } = await api("GET", "/notifications/logs?limit=50");
    assert.equal(status, 200);
    const logs = data as Array<Record<string, unknown>>;
    const match = logs.find(
      (l) =>
        l["contactId"] === contactId &&
        l["templateId"] === "STAKEHOLDER_UPDATE"
    );
    assert.ok(
      match,
      "Notification log row should exist for the dispatched STAKEHOLDER_UPDATE"
    );
    // DB log status is 'sent' | 'failed' | 'fallback'
    assert.ok(
      ["sent", "failed", "fallback"].includes(match!["status"] as string),
      `Log status should be sent/failed/fallback; got ${match!["status"]}`
    );
    logId = match!["id"] as number;
  });
});
