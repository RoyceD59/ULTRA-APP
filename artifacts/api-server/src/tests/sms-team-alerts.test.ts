/**
 * Tests for SMS team alerts in the recovery-order flow.
 *
 * Covers:
 *   (a) alertTeamRecoveryOrder() calls sendSms when TEAM_ALERT_PHONE is set
 *   (b) alertTeamRecoveryOrder() skips SMS (no error) when TEAM_ALERT_PHONE is absent
 *   (c) runStaleRecoveryOrderDigest() sends SMS digest when stale orders exist
 *   (d) runStaleRecoveryOrderDigest() skips gracefully when no stale orders found
 *   (e) sendSms network failure does not suppress the email or throw
 *   (f) AT returning 401 still sends the email and logs status=failed in uc_notification_log
 *   (g) AT returning 500 still sends the email and logs status=failed in uc_notification_log
 *   (h) alertTeamRecoveryOrder() still calls AT SMS when Resend is down
 *   (i) alertTeamRecoveryOrder() uses the DB phone number when set in team_settings
 *   (e2)/(e3) runStaleRecoveryOrderDigest() still attempts the email and logs
 *             status=failed when AT returns 401 / 500
 *
 * Strategy:
 *   - alertTeamRecoveryOrder is tested by intercepting globalThis.fetch for both
 *     the Resend (email) call and the Africa's Talking (SMS) call.
 *   - getTeamAlertPhone reads DB first then falls back to TEAM_ALERT_PHONE env var;
 *     the DB select is monkey-patched to return empty so the env-var path is exercised.
 *   - runStaleRecoveryOrderDigest is tested by monkey-patching db.select to return
 *     controlled order rows; TEAM_ALERT_PHONE is set/cleared per scenario.
 *   - AT credentials (AT_API_KEY / AT_USERNAME) are set to stub values so sendSms
 *     actually fires fetch rather than no-oping.
 *   - For (f) and (g) the insert stub is upgraded to capture log rows so the test
 *     can assert status=failed is written to uc_notification_log.
 *
 * No real HTTP server or database rows are required for these unit tests.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── DB monkey-patch (shared) ─────────────────────────────────────────────────
// We patch db.select so that:
//   • getTeamAlertPhone() finds no DB row → falls back to TEAM_ALERT_PHONE env var
//   • runStaleRecoveryOrderDigest() receives a controlled orders array
//
// The patch must be installed before the modules under test are imported (they
// share the same runtime object via the ESM cache).

import { db } from "@workspace/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalSelect = (db as any).select.bind(db);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalInsert = (db as any).insert.bind(db);

/** Rows returned by the next db.select() chain. `null` means use the original. */
let selectStub: unknown[] | null = null;

function installSelectStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = (_cols?: unknown) => ({
    from: (_table: unknown) => ({
      where: (_cond: unknown) => ({
        limit: (_n: unknown) => Promise.resolve(selectStub ?? []),
        // for queries without .limit()
        then: (resolve: (v: unknown[]) => void) => resolve(selectStub ?? []),
      }),
      orderBy: (_col: unknown) => ({
        limit: (_n: unknown) => Promise.resolve(selectStub ?? []),
      }),
      // for queries without .where()
      limit: (_n: unknown) => Promise.resolve(selectStub ?? []),
    }),
  });
}

function restoreSelect(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = originalSelect;
}

/** Rows captured by the insert stub — cleared per test when needed. */
let capturedInserts: unknown[] = [];

function installInsertStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (_table: unknown) => ({
    values: (vals: unknown) => {
      capturedInserts.push(vals);
      return {
        catch: () => {},
        onConflictDoNothing: () => Promise.resolve(),
      };
    },
  });
}

function restoreInsert(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = originalInsert;
}

// ─── fetch capture helper ─────────────────────────────────────────────────────

/** Captured fetch requests (URL, body text) during a test. */
interface CapturedRequest {
  url: string;
  bodyText: string;
}

let capturedRequests: CapturedRequest[] = [];
let realFetch: typeof globalThis.fetch;

function installFetchStub(): void {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const bodyText = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
    capturedRequests.push({ url, bodyText });

    // Return a plausible success for both Resend and Africa's Talking
    const isResend = url.includes("resend.com") || url.includes("resend");
    if (isResend) {
      return new Response(JSON.stringify({ id: "test-resend-id" }), { status: 200 });
    }
    // AT response
    return new Response(
      JSON.stringify({ SMSMessageData: { Recipients: [{ status: "Success", statusCode: 101 }] } }),
      { status: 200 },
    );
  };
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

function waitTick(ms = 80): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── alertTeamRecoveryOrder ────────────────────────────────────────────────────

describe("alertTeamRecoveryOrder — SMS team alerts", () => {
  before(() => {
    // AT credentials present so sendSms fires fetch (rather than no-oping)
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";
    // DB select returns empty → phone falls back to TEAM_ALERT_PHONE env var
    installSelectStub();
    // DB insert no-ops (notification log writes)
    installInsertStub();
    installFetchStub();
  });

  after(() => {
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];
    delete process.env["TEAM_ALERT_PHONE"];
    restoreSelect();
    restoreInsert();
    restoreFetch();
  });

  beforeEach(async () => {
    capturedRequests = [];
    capturedInserts  = [];
    selectStub = []; // DB returns no team_settings row → env-var fallback

    // Invalidate the phone cache so each test reads fresh env var
    const { invalidateTeamAlertPhoneCache } = await import("../routes/payments.js");
    invalidateTeamAlertPhoneCache();
  });

  it("(a) calls sendSms (fires fetch to AT) when TEAM_ALERT_PHONE is set", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000001";

    const { alertTeamRecoveryOrder } = await import("../routes/payments.js");
    alertTeamRecoveryOrder({
      subject:  "Test recovery alert",
      body:     "Order details here",
      smsText:  "UCFilters: recovery order #1 needs fulfilment.",
      template: "payment_recovery_alert",
      orderId:  1,
    });

    // sendSms is fire-and-forget; wait for the async fetch to complete
    await waitTick();

    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(atRequests.length >= 1, "At least one Africa's Talking fetch should be made");

    const bodyText = atRequests[0]!.bodyText;
    assert.ok(bodyText.includes("254700000001"), `AT body should contain normalised phone; got: ${bodyText}`);
    assert.ok(
      bodyText.includes(encodeURIComponent("UCFilters")) || bodyText.includes("UCFilters"),
      `AT body should contain the SMS text; got: ${bodyText}`,
    );
  });

  it("(b) skips SMS (no AT fetch, no error) when TEAM_ALERT_PHONE is absent", async () => {
    delete process.env["TEAM_ALERT_PHONE"];

    const { alertTeamRecoveryOrder } = await import("../routes/payments.js");

    // Must not throw
    assert.doesNotThrow(() => {
      alertTeamRecoveryOrder({
        subject:  "Test recovery alert",
        body:     "Order details here",
        smsText:  "UCFilters: recovery order #2 needs fulfilment.",
        template: "payment_recovery_alert",
        orderId:  2,
      });
    });

    await waitTick();

    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.equal(atRequests.length, 0, "No Africa's Talking fetch should be made when phone is absent");
  });

  it("(h) Resend outage — AT SMS is still sent with correct phone and function does not throw", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000099";
    // Force sendViaResend onto the fetch path (not connectors.proxy) so our stub intercepts it
    process.env["RESEND_BASE_URL"] = "https://api.resend.com";

    // Override fetch: Resend throws (outage), AT succeeds
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const bodyText = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      capturedRequests.push({ url, bodyText });

      if (url.includes("resend.com") || url.includes("api.resend")) {
        throw new Error("Simulated Resend outage");
      }
      // AT succeeds
      return new Response(
        JSON.stringify({ SMSMessageData: { Recipients: [{ status: "Success", statusCode: 101 }] } }),
        { status: 200 },
      );
    };

    const { alertTeamRecoveryOrder } = await import("../routes/payments.js");

    assert.doesNotThrow(() => {
      alertTeamRecoveryOrder({
        subject:  "Test recovery alert — Resend down",
        body:     "Order details here",
        smsText:  "UCFilters: recovery order #9 needs fulfilment.",
        template: "payment_recovery_alert",
        orderId:  9,
      });
    });

    await waitTick(120);

    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(atRequests.length >= 1, "Africa's Talking should be called even when Resend is down");

    const bodyText = atRequests[0]!.bodyText;
    assert.ok(
      bodyText.includes("254700000099"),
      `AT body should contain the normalised phone; got: ${bodyText}`,
    );

    globalThis.fetch = savedFetch;
    delete process.env["RESEND_BASE_URL"];
  });

  it("(i) uses DB phone number instead of env var when team_settings has one", async () => {
    const envPhone = "+254700000001";   // env-var phone — must NOT appear in AT body
    const dbPhone  = "+254799888777";
    process.env["TEAM_ALERT_PHONE"] = envPhone;

    // DB select returns a row with teamAlertPhone populated.
    selectStub = [{ teamAlertPhone: dbPhone }];

    const { alertTeamRecoveryOrder } = await import("../routes/payments.js");

    assert.doesNotThrow(() => {
      alertTeamRecoveryOrder({
        subject:  "Test recovery alert — DB phone",
        body:     "Order details here",
        smsText:  "UCFilters: recovery order #10 needs fulfilment.",
        template: "payment_recovery_alert",
        orderId:  10,
      });
    });

    await waitTick(120);

    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(atRequests.length >= 1, "AT fetch should be made");

    const bodyText = atRequests[0]!.bodyText;
    assert.ok(
      bodyText.includes("254799888777"),
      `AT body should use DB phone; got: ${bodyText}`,
    );
    assert.ok(
      !bodyText.includes("254700000001"),
      `AT body should NOT use env-var phone; got: ${bodyText}`,
    );
  });

  it("(e) sendSms network failure does not suppress the email or throw", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000099";
    // Force sendViaResend to use the fetch path (not connectors.proxy) so our
    // fetch stub can capture the Resend call.
    process.env["RESEND_BASE_URL"] = "https://api.resend.com";

    // Override fetch so AT calls reject but Resend calls succeed
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const bodyText = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      capturedRequests.push({ url, bodyText });

      if (url.includes("africastalking.com")) {
        throw new Error("Simulated AT network failure");
      }
      // Resend succeeds
      return new Response(JSON.stringify({ id: "resend-ok" }), { status: 200 });
    };

    const { alertTeamRecoveryOrder } = await import("../routes/payments.js");

    // Must not throw even though SMS will fail
    assert.doesNotThrow(() => {
      alertTeamRecoveryOrder({
        subject:  "Test recovery alert",
        body:     "Order details here",
        smsText:  "UCFilters: recovery order #3 needs fulfilment.",
        template: "payment_recovery_alert",
        orderId:  3,
      });
    });

    // Allow both the email and the (failing) SMS fetch to settle
    await waitTick(120);

    // Email (Resend) must still have been attempted
    const resendRequests = capturedRequests.filter((r) =>
      r.url.includes("resend.com") || r.url.includes("api.resend")
    );
    assert.ok(
      resendRequests.length >= 1,
      "Resend email should still be attempted even when SMS fails",
    );

    // AT was attempted (credentials + phone are both present)
    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(atRequests.length >= 1, "AT fetch should have been attempted before failing");

    globalThis.fetch = savedFetch;
    delete process.env["RESEND_BASE_URL"];
  });

  it("(f) AT returning 401 still sends the email and logs status=failed", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000010";
    process.env["RESEND_BASE_URL"]  = "https://api.resend.com";

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const bodyText = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      capturedRequests.push({ url, bodyText });

      if (url.includes("africastalking.com")) {
        // Simulate AT returning HTTP 401 Unauthorized
        return new Response("Unauthorized", { status: 401 });
      }
      // Resend succeeds
      return new Response(JSON.stringify({ id: "resend-ok" }), { status: 200 });
    };

    const { alertTeamRecoveryOrder } = await import("../routes/payments.js");

    // Must not throw even though AT returns 401
    assert.doesNotThrow(() => {
      alertTeamRecoveryOrder({
        subject:  "Test recovery alert",
        body:     "Order details here",
        smsText:  "UCFilters: recovery order #4 needs fulfilment.",
        template: "payment_recovery_alert",
        orderId:  4,
      });
    });

    // Allow the fire-and-forget chains to settle
    await waitTick(120);

    // Email (Resend) must still have been attempted
    const resendRequests = capturedRequests.filter((r) =>
      r.url.includes("resend.com") || r.url.includes("api.resend")
    );
    assert.ok(
      resendRequests.length >= 1,
      "Resend email should still be attempted when AT returns 401",
    );

    // AT was attempted
    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(atRequests.length >= 1, "AT fetch should have been attempted");

    // uc_notification_log should have a failed row for the SMS attempt
    const failedLogRows = capturedInserts.filter((row) => {
      const r = row as Record<string, unknown>;
      return r["channel"] === "sms" && r["status"] === "failed";
    });
    assert.ok(
      failedLogRows.length >= 1,
      `uc_notification_log should contain a status=failed SMS row; captured inserts: ${JSON.stringify(capturedInserts)}`,
    );
    const logRow = failedLogRows[0] as Record<string, unknown>;
    assert.ok(
      String(logRow["errorMessage"] ?? "").includes("401"),
      `errorMessage should reference the 401 status; got: ${logRow["errorMessage"]}`,
    );
    assert.equal(
      logRow["recipient"],
      "+254700000010",
      `log row recipient should be the normalised E.164 phone; got: ${logRow["recipient"]}`,
    );
    assert.equal(
      logRow["template"],
      "payment_recovery_alert",
      `log row template should match the meta template; got: ${logRow["template"]}`,
    );
    assert.equal(logRow["channel"], "sms", "log row channel should be 'sms'");
    assert.equal(
      logRow["provider"],
      "africas_talking",
      "log row provider should be 'africas_talking'",
    );

    globalThis.fetch = savedFetch;
    delete process.env["RESEND_BASE_URL"];
  });

  it("(g) AT returning 500 still sends the email and logs status=failed", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000011";
    process.env["RESEND_BASE_URL"]  = "https://api.resend.com";

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const bodyText = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      capturedRequests.push({ url, bodyText });

      if (url.includes("africastalking.com")) {
        // Simulate AT returning HTTP 500 Internal Server Error
        return new Response("Internal Server Error", { status: 500 });
      }
      // Resend succeeds
      return new Response(JSON.stringify({ id: "resend-ok" }), { status: 200 });
    };

    const { alertTeamRecoveryOrder } = await import("../routes/payments.js");

    // Must not throw even though AT returns 500
    assert.doesNotThrow(() => {
      alertTeamRecoveryOrder({
        subject:  "Test recovery alert",
        body:     "Order details here",
        smsText:  "UCFilters: recovery order #5 needs fulfilment.",
        template: "payment_recovery_alert",
        orderId:  5,
      });
    });

    // Allow the fire-and-forget chains to settle
    await waitTick(120);

    // Email (Resend) must still have been attempted
    const resendRequests = capturedRequests.filter((r) =>
      r.url.includes("resend.com") || r.url.includes("api.resend")
    );
    assert.ok(
      resendRequests.length >= 1,
      "Resend email should still be attempted when AT returns 500",
    );

    // AT was attempted
    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(atRequests.length >= 1, "AT fetch should have been attempted");

    // uc_notification_log should have a failed row for the SMS attempt
    const failedLogRows = capturedInserts.filter((row) => {
      const r = row as Record<string, unknown>;
      return r["channel"] === "sms" && r["status"] === "failed";
    });
    assert.ok(
      failedLogRows.length >= 1,
      `uc_notification_log should contain a status=failed SMS row; captured inserts: ${JSON.stringify(capturedInserts)}`,
    );
    const logRow = failedLogRows[0] as Record<string, unknown>;
    assert.ok(
      String(logRow["errorMessage"] ?? "").includes("500"),
      `errorMessage should reference the 500 status; got: ${logRow["errorMessage"]}`,
    );
    assert.equal(
      logRow["recipient"],
      "+254700000011",
      `log row recipient should be the normalised E.164 phone; got: ${logRow["recipient"]}`,
    );
    assert.equal(
      logRow["template"],
      "payment_recovery_alert",
      `log row template should match the meta template; got: ${logRow["template"]}`,
    );
    assert.equal(logRow["channel"], "sms", "log row channel should be 'sms'");
    assert.equal(
      logRow["provider"],
      "africas_talking",
      "log row provider should be 'africas_talking'",
    );

    globalThis.fetch = savedFetch;
    delete process.env["RESEND_BASE_URL"];
  });
});

// ─── runStaleRecoveryOrderDigest ───────────────────────────────────────────────

describe("runStaleRecoveryOrderDigest — digest SMS alerts", () => {
  before(() => {
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";
    installSelectStub();
    installInsertStub();
    installFetchStub();
  });

  after(() => {
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];
    delete process.env["TEAM_ALERT_PHONE"];
    restoreSelect();
    restoreInsert();
    restoreFetch();
  });

  beforeEach(async () => {
    capturedRequests = [];
    capturedInserts  = [];
    // The digest resolves the phone via getTeamAlertPhone (60 s cache) — bust it
    // so each scenario exercises its own DB/env configuration.
    const { invalidateTeamAlertPhoneCache } = await import("../routes/payments.js");
    invalidateTeamAlertPhoneCache();
  });

  it("(c) sends SMS digest when stale orders exist and TEAM_ALERT_PHONE is set", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000002";

    // Return two stale orders from db.select
    const createdAt = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 h ago
    selectStub = [
      {
        id: 101,
        paymentMethod: "mpesa",
        total: "4500",
        status: "processing",
        paymentReference: "LGR001",
        dateCreated: createdAt,
        webhookRecovery: true,
        userId: "anon",
        currency: "KES",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {},
      },
      {
        id: 102,
        paymentMethod: "paystack",
        total: "2000",
        status: "pending",
        paymentReference: "PS002",
        dateCreated: createdAt,
        webhookRecovery: true,
        userId: "anon",
        currency: "KES",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {},
      },
    ];

    const { runStaleRecoveryOrderDigest } = await import("../lib/scheduler.js");
    await runStaleRecoveryOrderDigest();

    // One Resend call (email) + one AT call (SMS)
    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(atRequests.length >= 1, "Africa's Talking should be called for the SMS digest");

    const bodyText = atRequests[0]!.bodyText;
    assert.ok(
      bodyText.includes("254700000002"),
      `AT body should contain normalised phone; got: ${bodyText}`,
    );
    // SMS body should mention both order IDs
    const decoded = decodeURIComponent(bodyText);
    assert.ok(
      decoded.includes("101") || bodyText.includes("101"),
      `SMS body should reference order #101; got: ${bodyText}`,
    );
    assert.ok(
      decoded.includes("102") || bodyText.includes("102"),
      `SMS body should reference order #102; got: ${bodyText}`,
    );
  });

  it("(c2) digest SMS uses the DB (admin-panel) phone when TEAM_ALERT_PHONE is absent", async () => {
    delete process.env["TEAM_ALERT_PHONE"];

    const dbPhone = "+254733555444";
    const createdAt = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 h ago

    // The shared select stub serves BOTH the stale-orders query and the
    // team_settings lookup inside getTeamAlertPhone, so the row carries the
    // order fields AND teamAlertPhone.
    selectStub = [
      {
        id: 201,
        paymentMethod: "mpesa",
        total: "3000",
        status: "processing",
        paymentReference: "LGR201",
        dateCreated: createdAt,
        webhookRecovery: true,
        userId: "anon",
        currency: "KES",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {},
        teamAlertPhone: dbPhone,
      },
    ];

    // Bust the 60 s phone cache so the DB path is exercised, not a stale env value
    const { invalidateTeamAlertPhoneCache } = await import("../routes/payments.js");
    invalidateTeamAlertPhoneCache();

    const { runStaleRecoveryOrderDigest } = await import("../lib/scheduler.js");
    await runStaleRecoveryOrderDigest();

    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.ok(
      atRequests.length >= 1,
      "Africa's Talking should be called for the digest SMS using the DB phone",
    );

    const bodyText = atRequests[0]!.bodyText;
    assert.ok(
      bodyText.includes("254733555444"),
      `AT body should contain the DB-sourced phone; got: ${bodyText}`,
    );

    // Invalidate again so the cached DB phone doesn't leak into later tests
    invalidateTeamAlertPhoneCache();
  });

  /**
   * Shared runner for the AT-rejection digest scenarios: stubs one stale order,
   * makes the AT fetch return `atStatus`, runs the digest, and asserts that the
   * Resend email is still attempted and a status=failed SMS row is logged.
   */
  async function runDigestWithAtRejection(atStatus: number, orderId: number): Promise<void> {
    process.env["TEAM_ALERT_PHONE"] = "+254700000020";
    // Force sendViaResend onto the fetch path so the stub captures the email call
    process.env["RESEND_BASE_URL"] = "https://api.resend.com";

    const createdAt = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 h ago
    selectStub = [
      {
        id: orderId,
        paymentMethod: "mpesa",
        total: "5000",
        status: "processing",
        paymentReference: `LGR${orderId}`,
        dateCreated: createdAt,
        webhookRecovery: true,
        userId: "anon",
        currency: "KES",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {},
      },
    ];

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const bodyText = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      capturedRequests.push({ url, bodyText });

      if (url.includes("africastalking.com")) {
        // Simulate AT rejecting the SMS
        return new Response(atStatus === 401 ? "Unauthorized" : "Internal Server Error", {
          status: atStatus,
        });
      }
      // Resend succeeds
      return new Response(JSON.stringify({ id: "resend-ok" }), { status: 200 });
    };

    try {
      const { runStaleRecoveryOrderDigest } = await import("../lib/scheduler.js");

      // Must not throw even though AT rejects the SMS
      let threw = false;
      try {
        await runStaleRecoveryOrderDigest();
      } catch {
        threw = true;
      }
      assert.ok(!threw, `digest must not throw when AT returns ${atStatus}`);

      // Allow any fire-and-forget log writes to settle
      await waitTick(120);

      // Email (Resend) must still have been attempted
      const resendRequests = capturedRequests.filter((r) =>
        r.url.includes("resend.com") || r.url.includes("api.resend")
      );
      assert.ok(
        resendRequests.length >= 1,
        `Resend email should still be attempted when AT returns ${atStatus}`,
      );

      // AT was attempted
      const atRequests = capturedRequests.filter((r) =>
        r.url.includes("africastalking.com")
      );
      assert.ok(atRequests.length >= 1, "AT fetch should have been attempted");

      // uc_notification_log should have a failed row for the SMS attempt
      const failedLogRows = capturedInserts.filter((row) => {
        const r = row as Record<string, unknown>;
        return r["channel"] === "sms" && r["status"] === "failed";
      });
      assert.ok(
        failedLogRows.length >= 1,
        `uc_notification_log should contain a status=failed SMS row; captured inserts: ${JSON.stringify(capturedInserts)}`,
      );
      const logRow = failedLogRows[0] as Record<string, unknown>;
      assert.ok(
        String(logRow["errorMessage"] ?? "").includes(String(atStatus)),
        `errorMessage should reference the ${atStatus} status; got: ${logRow["errorMessage"]}`,
      );
    } finally {
      globalThis.fetch = savedFetch;
      delete process.env["RESEND_BASE_URL"];
    }
  }

  it("(e2) AT returning 401 — digest email still attempted and status=failed logged", async () => {
    await runDigestWithAtRejection(401, 301);
  });

  it("(e3) AT returning 500 — digest email still attempted and status=failed logged", async () => {
    await runDigestWithAtRejection(500, 302);
  });

  it("(j) both channels down — durable status=failed digest row written to uc_notification_log", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000030";
    process.env["RESEND_BASE_URL"]  = "https://api.resend.com";

    const createdAt = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 h ago
    selectStub = [
      {
        id: 401,
        paymentMethod: "mpesa",
        total: "6000",
        status: "processing",
        paymentReference: "LGR401",
        dateCreated: createdAt,
        webhookRecovery: true,
        userId: "anon",
        currency: "KES",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {},
      },
    ];

    // Both Resend and AT fail
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("resend.com") || url.includes("api.resend")) {
        throw new Error("Simulated Resend outage");
      }
      if (url.includes("africastalking.com")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    // Bust phone cache so the test's env phone is resolved fresh
    const { invalidateTeamAlertPhoneCache } = await import("../routes/payments.js");
    invalidateTeamAlertPhoneCache();

    try {
      const { runStaleRecoveryOrderDigest } = await import("../lib/scheduler.js");

      let threw = false;
      try {
        await runStaleRecoveryOrderDigest();
      } catch {
        threw = true;
      }
      assert.ok(!threw, "digest must not throw when both channels fail");

      // Allow fire-and-forget log writes to settle
      await waitTick(120);

      // A durable failure row must be written with channel='digest' and status='failed'
      const digestFailRows = capturedInserts.filter((row) => {
        const r = row as Record<string, unknown>;
        return r["channel"] === "digest" && r["status"] === "failed";
      });
      assert.ok(
        digestFailRows.length >= 1,
        `uc_notification_log should contain a status=failed digest row when both channels fail; captured inserts: ${JSON.stringify(capturedInserts)}`,
      );
      const logRow = digestFailRows[0] as Record<string, unknown>;
      assert.equal(logRow["template"], "recovery_order_digest", "log row template should be recovery_order_digest");
      assert.ok(
        String(logRow["errorMessage"] ?? "").toLowerCase().includes("both"),
        `errorMessage should mention both channels failing; got: ${logRow["errorMessage"]}`,
      );
    } finally {
      globalThis.fetch = savedFetch;
      delete process.env["RESEND_BASE_URL"];
    }
  });

  it("(d) skips gracefully (no SMS, no error) when no stale orders found", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000003";
    selectStub = []; // empty result — no stale orders

    const { runStaleRecoveryOrderDigest } = await import("../lib/scheduler.js");

    // Must not throw
    let threw = false;
    try {
      await runStaleRecoveryOrderDigest();
    } catch {
      threw = true;
    }
    assert.ok(!threw, "digest should not throw when there are no stale orders");

    await waitTick();

    const atRequests = capturedRequests.filter((r) =>
      r.url.includes("africastalking.com")
    );
    assert.equal(atRequests.length, 0, "No SMS should be sent when there are no stale orders");
  });
});
