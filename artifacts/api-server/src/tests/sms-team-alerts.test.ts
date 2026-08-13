/**
 * Tests for SMS team alerts in the recovery-order flow.
 *
 * Covers:
 *   (a) alertTeamRecoveryOrder() calls sendSms when TEAM_ALERT_PHONE is set
 *   (b) alertTeamRecoveryOrder() skips SMS (no error) when TEAM_ALERT_PHONE is absent
 *   (c) runStaleRecoveryOrderDigest() sends SMS digest when stale orders exist
 *   (d) runStaleRecoveryOrderDigest() skips gracefully when no stale orders found
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

function installInsertStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (_table: unknown) => ({
    values: (_vals: unknown) => ({ catch: () => {} }),
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

  beforeEach(() => {
    capturedRequests = [];
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

  it("(e) sends SMS even when sendViaResend returns false, and warns about the email failure", async () => {
    process.env["TEAM_ALERT_PHONE"] = "+254700000004";
    // Force sendViaResend to use the fetch path so our stub can control it
    process.env["RESEND_BASE_URL"] = "https://api.resend.com";

    // Two stale orders so the digest has content
    const createdAt = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 h ago
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
      },
    ];

    // Override fetch: Resend → 500 (email fails), AT → 200 (SMS succeeds)
    const savedFetch = globalThis.fetch;
    const localCapture: CapturedRequest[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const bodyText = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      localCapture.push({ url, bodyText });

      if (url.includes("resend")) {
        // Simulate Resend being down — sendViaResend will return false
        return new Response(JSON.stringify({ name: "service_unavailable" }), { status: 503 });
      }
      // Africa's Talking succeeds
      return new Response(
        JSON.stringify({ SMSMessageData: { Recipients: [{ status: "Success", statusCode: 101 }] } }),
        { status: 200 },
      );
    };

    // Spy on logger.warn to confirm the email-failure warning fires
    const { logger } = await import("../lib/logger.js");
    const warnMessages: string[] = [];
    const originalWarn = logger.warn.bind(logger);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).warn = (...args: unknown[]) => {
      const msg = args.find((a) => typeof a === "string") as string | undefined;
      if (msg) warnMessages.push(msg);
    };

    try {
      const { runStaleRecoveryOrderDigest } = await import("../lib/scheduler.js");
      await runStaleRecoveryOrderDigest();

      await waitTick(120);

      // Email was attempted (Resend fetch fired)
      const resendRequests = localCapture.filter((r) => r.url.includes("resend"));
      assert.ok(resendRequests.length >= 1, "Resend should have been attempted even though it fails");

      // SMS was still sent (AT fetch fired) despite email failure
      const atRequests = localCapture.filter((r) => r.url.includes("africastalking.com"));
      assert.ok(
        atRequests.length >= 1,
        "Africa's Talking SMS should still be sent when sendViaResend returns false",
      );

      // SMS body should reference the stale order
      const decoded = decodeURIComponent(atRequests[0]!.bodyText);
      assert.ok(
        decoded.includes("201") || atRequests[0]!.bodyText.includes("201"),
        `SMS body should reference order #201; got: ${atRequests[0]!.bodyText}`,
      );

      // Logger warned about the email failure before falling back to SMS
      const emailFailureWarning = warnMessages.find((m) =>
        m.includes("digest email failed") || m.includes("SMS fallback"),
      );
      assert.ok(
        emailFailureWarning != null,
        `logger.warn should mention email failure / SMS fallback; captured warnings: ${JSON.stringify(warnMessages)}`,
      );
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (logger as any).warn = originalWarn;
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
