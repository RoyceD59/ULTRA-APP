/**
 * Integration tests for POST /api/uc/admin/notification-logs/:id/retry
 *
 * Covers:
 *   (a) 403 when no admin auth token provided
 *   (b) 400 when row status='sent' — only failed rows may be retried
 *   (c) 409 when a later successful delivery for the same entity supersedes
 *       the failed row (entity-aware: matched on orderId)
 *   (d) No 409 when a later success exists for a DIFFERENT orderId (unrelated
 *       success must not block the retry)
 *   (e) 200 happy-path retry for a failed SMS row; verifies:
 *       - response is ok=true with the recipient in the message
 *       - retry attempt is asynchronously logged to the DB
 *   (f) HTML escaping: stored body with HTML specials is properly escaped in
 *       the email sent by the actual retry endpoint (captures the SendGrid
 *       request body to verify)
 *
 * The app is started on an ephemeral port (listen(0)) so tests never clash
 * with the running dev server. All DB rows and users created during tests are
 * deleted in the after() hook.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";

import app from "../app.js";
import { db, ucUsersTable, ucNotificationLogTable } from "@workspace/db";
import { eq, inArray, and, gt, ne } from "drizzle-orm";

// ── Server setup ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;
let adminJwt: string;

const TEST_ADMIN_EMAIL    = `notif-retry-test-${Date.now()}@uctest.internal`;
const TEST_ADMIN_PASSWORD = "test-secret-pw-12345";
const createdUserIds: number[] = [];
const createdLogIds:  number[] = [];

before(
  async () => {
    // 1. Start the app on a random free port.
    await new Promise<void>((resolve, reject) => {
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
    });

    // 2. Create a test admin user in the DB.
    const passwordHash = await bcryptjs.hash(TEST_ADMIN_PASSWORD, 4); // low cost for test speed
    const [user] = await db
      .insert(ucUsersTable)
      .values({
        email:        TEST_ADMIN_EMAIL,
        passwordHash,
        firstName:    "Test",
        lastName:     "Admin",
        phone:        "+254700000099",
        isAdmin:      true,
      })
      .returning({ id: ucUsersTable.id });
    createdUserIds.push(user!.id);

    // 3. Log in to obtain a signed JWT.
    const resp = await fetch(`${base}/uc/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(resp.status, 200, "login must succeed for the test admin user");
    const body = await resp.json() as { token?: string };
    assert.ok(body.token, "login response must include a JWT token");
    adminJwt = body.token!;
  },
  { timeout: 30_000 },
);

after(async () => {
  if (createdLogIds.length > 0) {
    await db
      .delete(ucNotificationLogTable)
      .where(inArray(ucNotificationLogTable.id, createdLogIds));
  }
  if (createdUserIds.length > 0) {
    await db
      .delete(ucUsersTable)
      .where(inArray(ucUsersTable.id, createdUserIds));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── DB helper ─────────────────────────────────────────────────────────────────

async function insertLog(
  overrides: Partial<{
    channel:      string;
    recipient:    string;
    template:     string;
    messageBody:  string;
    orderId:      number;
    ticketId:     string;
    testId:       string;
    status:       string;
    errorMessage: string;
    sentAt:       Date;
  }>,
): Promise<number> {
  const [row] = await db
    .insert(ucNotificationLogTable)
    .values({
      channel:      overrides.channel     ?? "sms",
      recipient:    overrides.recipient   ?? "+254712000099",
      template:     overrides.template    ?? "order_confirmation",
      messageBody:  overrides.messageBody ?? "Test message body",
      orderId:      overrides.orderId,
      ticketId:     overrides.ticketId,
      testId:       overrides.testId,
      status:       overrides.status      ?? "failed",
      errorMessage: overrides.errorMessage,
      sentAt:       overrides.sentAt      ? overrides.sentAt : undefined,
    })
    .returning({ id: ucNotificationLogTable.id });
  const id = row!.id;
  createdLogIds.push(id);
  return id;
}

/** Call the retry endpoint and return the raw Response. */
function callRetry(id: number, token?: string): Promise<Response> {
  return fetch(`${base}/uc/admin/notification-logs/${id}/retry`, {
    method:  "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function callList(token: string): Promise<Response> {
  return fetch(`${base}/uc/admin/notification-logs?limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Stub only external API calls (AT, SendGrid, Resend, …) without intercepting
 * requests to our own server on 127.0.0.1/localhost.
 */
function makeSelectiveFetchMock(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
): (url: unknown, init?: unknown) => Promise<Response> {
  const origFetch = globalThis.fetch;
  return async (url: unknown, init?: unknown) => {
    const u = String(url);
    if (u.includes("127.0.0.1") || u.includes("localhost")) {
      return origFetch(u, init as RequestInit);
    }
    return handler(u, init as RequestInit | undefined);
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /uc/admin/notification-logs/:id/retry — authorization", () => {
  it("(a) returns 403 when no Authorization header is provided", async () => {
    const id = await insertLog({ status: "failed" });
    const resp = await callRetry(id);
    assert.equal(resp.status, 403);
  });
});

describe("POST /uc/admin/notification-logs/:id/retry — sent-row rejection", () => {
  it("(b) returns 400 when the log row has status=sent", async () => {
    const id = await insertLog({ status: "sent" });
    const resp = await callRetry(id, adminJwt);
    assert.equal(resp.status, 400, "retrying a sent row must be rejected with 400");
    const body = await resp.json() as { error?: string };
    assert.ok(
      body.error?.toLowerCase().includes("failed"),
      "error message should explain only failed rows can be retried",
    );
  });
});

describe("ProjectHub recovery notifications — privacy and retry guard", () => {
  it("redacts legacy recovery bodies and provider IDs from the generic log endpoint", async () => {
    const id = await insertLog({
      channel: "email",
      recipient: "projecthub-recovery-log@example.invalid",
      template: "projecthub_password_reset",
      messageBody: "https://projecthub.example/reset-password?token=secret-token",
      status: "failed",
    });
    await db.update(ucNotificationLogTable)
      .set({ resendMessageId: "resend-provider-id" })
      .where(eq(ucNotificationLogTable.id, id));

    const response = await callList(adminJwt);
    assert.equal(response.status, 200);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const row = rows.find((item) => item["id"] === id);
    assert.ok(row, "recovery log row should be present");
    assert.equal(row["messageBody"], "");
    assert.equal("resendMessageId" in row, false);
  });

  it("requires a fresh secure link instead of retrying a failed recovery email", async () => {
    const id = await insertLog({
      channel: "email",
      recipient: "projecthub-recovery-retry@example.invalid",
      template: "projecthub_invitation",
      messageBody: "",
      status: "failed",
    });

    const response = await callRetry(id, adminJwt);
    assert.equal(response.status, 409);
    const body = await response.json() as { error?: string };
    assert.match(body.error ?? "", /fresh secure link/i);
  });
});

describe("POST /uc/admin/notification-logs/:id/retry — supersession guard", () => {
  it("(c) returns 409 when a later sent row exists for the same entity (orderId)", async () => {
    const earlier = new Date(Date.now() - 6000);
    const failedId = await insertLog({
      channel:   "email",
      recipient: "customer@example.com",
      template:  "order_receipt",
      orderId:   9001,
      status:    "failed",
      sentAt:    earlier,
    });

    const later = new Date(Date.now() - 1000);
    await insertLog({
      channel:   "email",
      recipient: "customer@example.com",
      template:  "order_receipt",
      orderId:   9001,
      status:    "sent",
      sentAt:    later,
    });

    const resp = await callRetry(failedId, adminJwt);
    assert.equal(resp.status, 409, "should 409 when same orderId was later delivered successfully");
    const body = await resp.json() as { error?: string };
    assert.ok(body.error?.includes("successful delivery"), "error should mention the successful delivery");
  });

  it("(d) does NOT 409 when a later success is for a different orderId (unrelated)", async () => {
    const earlier = new Date(Date.now() - 6000);
    const failedId = await insertLog({
      channel:   "sms",
      recipient: "+254712000050",
      template:  "order_confirmation",
      orderId:   7001,
      status:    "failed",
      sentAt:    earlier,
    });

    // Different order — must NOT block retry for 7001.
    const later = new Date(Date.now() - 1000);
    await insertLog({
      channel:   "sms",
      recipient: "+254712000050",
      template:  "order_confirmation",
      orderId:   7002,
      status:    "sent",
      sentAt:    later,
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeSelectiveFetchMock(async () =>
      new Response(JSON.stringify({ SMSMessageData: {} }), { status: 200 }),
    );
    try {
      const resp = await callRetry(failedId, adminJwt);
      assert.notEqual(resp.status, 409, "different orderId must not trigger 409");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("POST /uc/admin/notification-logs/:id/retry — happy path", () => {
  it("(e) returns 200 and the retry attempt is logged to the DB asynchronously", async () => {
    const failedId = await insertLog({
      channel:      "sms",
      recipient:    "+254712000077",
      template:     "order_confirmation",
      orderId:      5555,
      messageBody:  "Hi! Your order #5555 is confirmed.",
      status:       "failed",
      errorMessage: "AT 401: invalid key",
    });

    // Capture `start` AFTER the insert so the polling query only matches rows
    // created during the retry (i.e. sentAt > start excludes the original row).
    const start = new Date();

    // Stub external calls only (not the request to our own server).
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeSelectiveFetchMock(async () =>
      new Response(JSON.stringify({ SMSMessageData: { Recipients: [] } }), { status: 200 }),
    );

    try {
      // ① HTTP response check.
      const resp = await callRetry(failedId, adminJwt);
      assert.equal(resp.status, 200, "happy-path retry should return 200");
      const body = await resp.json() as { ok?: boolean; message?: string };
      assert.equal(body.ok, true, "response body should have ok=true");
      assert.ok(body.message?.includes("+254712000077"), "response should mention the recipient");

      // ② DB persistence check: poll up to 2 s for the retry log row.
      let retryRow: { id: number; status: string } | undefined;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const [found] = await db
          .select({ id: ucNotificationLogTable.id, status: ucNotificationLogTable.status })
          .from(ucNotificationLogTable)
          .where(
            and(
              eq(ucNotificationLogTable.recipient, "+254712000077"),
              eq(ucNotificationLogTable.orderId,   5555),
              gt(ucNotificationLogTable.sentAt,    start),
              ne(ucNotificationLogTable.id,        failedId),
            ),
          )
          .limit(1);
        if (found) { retryRow = found; break; }
      }
      assert.ok(retryRow, "a retry attempt must be persisted to uc_notification_log");
      // Confirm its id is not the original failed row.
      assert.notEqual(retryRow!.id, failedId, "the retry log row must be distinct from the original failed row");
      // Track for cleanup.
      createdLogIds.push(retryRow!.id);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("POST /uc/admin/notification-logs/:id/retry — HTML escaping", () => {
  it("(f) stored body with HTML specials is escaped in the email dispatched by the retry endpoint", async () => {
    const maliciousBody = '<script>alert("xss")</script> & it\'s "fine"';

    const failedId = await insertLog({
      channel:     "email",
      recipient:   "victim@example.com",
      template:    "order_receipt",
      orderId:     6666,
      messageBody: maliciousBody,
      status:      "failed",
    });

    // Temporarily enable the SendGrid path so an external HTTP call is made.
    // The real value is absent in the test environment, so this is a test-only key.
    const prevSgKey = process.env["SENDGRID_API_KEY"];
    process.env["SENDGRID_API_KEY"] = "test-fake-sg-key";

    let capturedHtml = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeSelectiveFetchMock(async (_url, init) => {
      // Capture every external API call body (SendGrid, Resend, etc.).
      try {
        const reqBody = JSON.parse((init?.body ?? "") as string) as Record<string, unknown>;
        // SendGrid format: { content: [{ type: "text/html", value: "..." }] }
        if (Array.isArray(reqBody.content)) {
          for (const c of reqBody.content as Array<{ type?: string; value?: string }>) {
            if (c.type === "text/html" && c.value) {
              capturedHtml = c.value;
            }
          }
        }
        // Resend/generic format: { html: "..." }
        if (!capturedHtml && typeof reqBody.html === "string") {
          capturedHtml = reqBody.html;
        }
      } catch { /* non-JSON body — skip */ }
      return new Response("", { status: 202 });
    });

    try {
      const resp = await callRetry(failedId, adminJwt);
      assert.equal(resp.status, 200, "retry must succeed");

      // Allow the fire-and-forget send to complete.
      await new Promise((r) => setTimeout(r, 600));

      // The retry endpoint HTML-escapes the stored body before wrapping it in
      // a <pre> block.  Verify the specials are encoded.
      assert.ok(capturedHtml.length > 0, "an external email API call must have been made by the retry endpoint");
      assert.ok(!capturedHtml.includes("<script>"),          "raw <script> must not appear in the email HTML");
      assert.ok(!capturedHtml.includes("</script>"),         "raw </script> must not appear in the email HTML");
      assert.ok(capturedHtml.includes("&lt;script&gt;"),     "< and > must be HTML-encoded");
      assert.ok(capturedHtml.includes("&amp;"),              "& must be HTML-encoded");
      assert.ok(capturedHtml.includes("&quot;"),             `" must be HTML-encoded`);
      assert.ok(capturedHtml.includes("&#x27;"),             `' must be HTML-encoded`);
    } finally {
      // Restore the original env and fetch.
      if (prevSgKey == null) {
        delete process.env["SENDGRID_API_KEY"];
      } else {
        process.env["SENDGRID_API_KEY"] = prevSgKey;
      }
      globalThis.fetch = origFetch;
    }
  });
});
