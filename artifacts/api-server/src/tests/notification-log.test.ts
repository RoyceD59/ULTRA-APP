/**
 * Tests for uc_notification_log integration in sms.ts, email.ts, and resend.ts.
 *
 * Verifies:
 *   (a) sendSms logs 'sent' when Africa's Talking returns 200
 *   (b) sendSms logs 'failed' when AT returns a non-2xx response
 *   (c) sendEmail logs 'sent' when SendGrid returns 202
 *   (d) sendEmail logs 'failed' when SendGrid returns a 4xx error
 *   (e) sendViaResend logs 'sent' on a 200 response
 *   (f) sendViaResend logs 'failed' on a non-2xx response
 *   (g) A DB write failure inside the log helper never propagates to the caller
 *
 * Strategy: monkey-patch `db.insert` on the shared @workspace/db instance so
 * the log helper's insert call can be intercepted without a live database.
 * globalThis.fetch is stubbed for all HTTP sends.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── DB insert interceptor ────────────────────────────────────────────────────

// We import the db object once and monkey-patch `insert` so every module that
// shares the same runtime import (sms.ts, email.ts, resend.ts) uses our stub.
import { db } from "@workspace/db";

type InsertedRow = Record<string, unknown>;

let insertedRows: InsertedRow[] = [];
let dbInsertShouldThrow = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalInsert = (db as any).insert.bind(db);

function installDbStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (_table: unknown) => ({
    values: (vals: InsertedRow) => {
      if (dbInsertShouldThrow) {
        return Promise.reject(new Error("DB unavailable (test)"));
      }
      insertedRows.push(vals);
      return Promise.resolve();
    },
  });
}

function restoreDbInsert(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = originalInsert;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function waitTick(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── sendSms ─────────────────────────────────────────────────────────────────

describe("sendSms — notification log", () => {
  before(() => {
    process.env["AT_API_KEY"]   = "test-at-key";
    process.env["AT_USERNAME"]  = "sandbox";
    installDbStub();
  });

  after(() => {
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];
    restoreDbInsert();
  });

  beforeEach(() => {
    insertedRows = [];
    dbInsertShouldThrow = false;
  });

  it("(a) writes status=sent when AT returns 200", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ SMSMessageData: { Recipients: [{ status: "Success" }] } }),
      { status: 200 },
    );

    try {
      const { sendSms, orderConfirmationSms } = await import("../lib/sms.js");
      const msg = orderConfirmationSms({ orderId: 42, total: "5000", firstName: "Amina" });
      sendSms("+254712000001", msg, { template: "order_confirmation", orderId: 42 });
      await waitTick();

      assert.equal(insertedRows.length, 1, "one log row should be inserted");
      assert.equal(insertedRows[0]!["status"],   "sent");
      assert.equal(insertedRows[0]!["channel"],  "sms");
      assert.equal(insertedRows[0]!["provider"], "africas_talking");
      assert.equal(insertedRows[0]!["template"], "order_confirmation");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("(b) writes status=failed when AT returns non-2xx", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("Invalid API key", { status: 401 });

    try {
      const { sendSms } = await import("../lib/sms.js");
      sendSms("+254712000002", "Hello", { template: "ticket_confirmation" });
      await waitTick();

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"], "failed");
      assert.ok(
        String(insertedRows[0]!["errorMessage"]).includes("401"),
        "errorMessage should contain the HTTP status code",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("(g-sms) a DB insert failure does not propagate to the caller", async () => {
    dbInsertShouldThrow = true;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });

    try {
      const { sendSms } = await import("../lib/sms.js");
      // Must complete without throwing even though the DB insert will reject
      assert.doesNotThrow(() => { sendSms("+254712000003", "Test"); });
      await waitTick();
    } finally {
      globalThis.fetch = origFetch;
      dbInsertShouldThrow = false;
    }
  });

  it("(i-sms) writes status=failed when fetch rejects with a network-level error", async () => {
    const networkError = new Error("getaddrinfo ENOTFOUND api.africastalking.com");
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw networkError; };

    try {
      const { sendSms } = await import("../lib/sms.js");
      sendSms("+254712000005", "Hello network-fail", { template: "order_confirmation", orderId: 77 });
      await waitTick();

      assert.equal(insertedRows.length, 1, "one log row should be inserted for a network error");
      assert.equal(insertedRows[0]!["status"], "failed");
      assert.ok(
        String(insertedRows[0]!["errorMessage"]).includes("getaddrinfo ENOTFOUND"),
        "errorMessage should include the network error text",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("(h-sms) writes status=failed when AT credentials are absent", async () => {
    // Temporarily remove credentials
    const savedKey  = process.env["AT_API_KEY"];
    const savedUser = process.env["AT_USERNAME"];
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];

    try {
      const { sendSms } = await import("../lib/sms.js");
      sendSms("+254712000004", "Hello uncredentialed", { template: "order_confirmation" });
      await waitTick();

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"], "failed");
      assert.ok(
        String(insertedRows[0]!["errorMessage"]).includes("credentials"),
        "errorMessage should mention missing credentials",
      );
    } finally {
      process.env["AT_API_KEY"]  = savedKey;
      process.env["AT_USERNAME"] = savedUser;
    }
  });
});

// ─── sendEmail ────────────────────────────────────────────────────────────────

describe("sendEmail — notification log", () => {
  before(() => {
    process.env["SENDGRID_API_KEY"] = "SG.test-log-key";
    delete process.env["SMTP_HOST"];
    installDbStub();
  });

  after(() => {
    delete process.env["SENDGRID_API_KEY"];
    restoreDbInsert();
  });

  beforeEach(() => {
    insertedRows = [];
    dbInsertShouldThrow = false;
  });

  it("(c) writes status=sent when SendGrid returns 202", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 202 });

    try {
      const { sendEmail } = await import("../lib/email.js");
      sendEmail({
        to: "customer@example.com",
        subject: "Your order is confirmed",
        html: "<p>Thanks</p>",
        text: "Thanks",
        template: "order_receipt",
        orderId: 99,
      });
      await waitTick();

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"],   "sent");
      assert.equal(insertedRows[0]!["channel"],  "email");
      assert.equal(insertedRows[0]!["provider"], "sendgrid");
      assert.equal(insertedRows[0]!["template"], "order_receipt");
      assert.equal(insertedRows[0]!["orderId"],  99);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("(d) writes status=failed when SendGrid returns 4xx and no SMTP fallback", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("Forbidden", { status: 403 });

    try {
      const { sendEmail } = await import("../lib/email.js");
      sendEmail({
        to: "customer@example.com",
        subject: "Ticket submitted",
        html: "<p>Received</p>",
        text: "Received",
        template: "ticket_confirmation",
        ticketId: "TKT-001",
      });
      await waitTick();

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"],   "failed");
      assert.equal(insertedRows[0]!["provider"], "sendgrid");
      assert.ok(
        String(insertedRows[0]!["errorMessage"]).includes("403"),
        "errorMessage should contain HTTP status",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("(j-email) SendGrid-failure + SMTP-success: logs both the SendGrid failure and the SMTP success as distinct rows", async () => {
    // Enable SMTP so sendEmail tries it after SendGrid fails.
    process.env["SMTP_HOST"] = "smtp.test.internal";
    process.env["SMTP_USER"] = "user@test.internal";
    process.env["SMTP_PASS"] = "test-pass";

    // Inject a mock SMTP transport that succeeds.
    const { _testSetSmtpTransport } = await import("../lib/email.js");
    _testSetSmtpTransport({ sendMail: async () => { /* mock success */ } });

    const origFetch = globalThis.fetch;
    // SendGrid returns 403 → failure.
    globalThis.fetch = async () => new Response("Forbidden", { status: 403 });

    try {
      const { sendEmail } = await import("../lib/email.js");
      sendEmail({
        to: "customer@example.com",
        subject: "Dual-provider test",
        html: "<p>test</p>",
        text: "test",
        template: "order_receipt",
        orderId: 1001,
      });
      // Give both async log writes time to complete.
      await waitTick(200);

      assert.equal(insertedRows.length, 2, "exactly 2 log rows must be written: one for each provider");

      // First row: SendGrid failure.
      const sgRow = insertedRows.find(r => r["provider"] === "sendgrid");
      assert.ok(sgRow,   "a log row with provider=sendgrid must exist");
      assert.equal(sgRow!["status"],   "failed");
      assert.ok(String(sgRow!["errorMessage"]).includes("403"), "SendGrid error must mention 403");
      assert.equal(sgRow!["template"], "order_receipt");
      assert.equal(sgRow!["orderId"],  1001);

      // Second row: SMTP success.
      const smtpRow = insertedRows.find(r => r["provider"] === "smtp");
      assert.ok(smtpRow, "a log row with provider=smtp must exist");
      assert.equal(smtpRow!["status"],   "sent");
      assert.equal(smtpRow!["template"], "order_receipt");
      assert.equal(smtpRow!["orderId"],  1001);
    } finally {
      globalThis.fetch = origFetch;
      _testSetSmtpTransport(null);
      delete process.env["SMTP_HOST"];
      delete process.env["SMTP_USER"];
      delete process.env["SMTP_PASS"];
    }
  });

  it("(k-email) SendGrid-failure + SMTP-failure: logs both provider failures as distinct rows", async () => {
    process.env["SMTP_HOST"] = "smtp.test.internal";
    process.env["SMTP_USER"] = "user@test.internal";
    process.env["SMTP_PASS"] = "test-pass";

    // Inject a mock SMTP transport that fails.
    const { _testSetSmtpTransport } = await import("../lib/email.js");
    _testSetSmtpTransport({
      sendMail: async () => { throw new Error("SMTP connection refused"); },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("Bad Gateway", { status: 502 });

    try {
      const { sendEmail } = await import("../lib/email.js");
      sendEmail({
        to: "customer@example.com",
        subject: "Dual-failure test",
        html: "<p>test</p>",
        text: "test",
        template: "ticket_confirmation",
        ticketId: "TKT-999",
      });
      await waitTick(200);

      assert.equal(insertedRows.length, 2, "exactly 2 log rows must be written: one per provider attempt");

      const sgRow   = insertedRows.find(r => r["provider"] === "sendgrid");
      const smtpRow = insertedRows.find(r => r["provider"] === "smtp");
      assert.ok(sgRow,   "a log row with provider=sendgrid must exist");
      assert.ok(smtpRow, "a log row with provider=smtp must exist");
      assert.equal(sgRow!["status"],   "failed");
      assert.equal(smtpRow!["status"], "failed");
      assert.ok(String(sgRow!["errorMessage"]).includes("502"),                 "SendGrid error must mention 502");
      assert.ok(String(smtpRow!["errorMessage"]).includes("connection refused"), "SMTP error must mention connection refused");
    } finally {
      globalThis.fetch = origFetch;
      _testSetSmtpTransport(null);
      delete process.env["SMTP_HOST"];
      delete process.env["SMTP_USER"];
      delete process.env["SMTP_PASS"];
    }
  });

  it("(g-email) a DB insert failure does not propagate to the caller", async () => {
    dbInsertShouldThrow = true;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 202 });

    try {
      const { sendEmail } = await import("../lib/email.js");
      assert.doesNotThrow(() => {
        sendEmail({ to: "x@example.com", subject: "S", html: "<p>H</p>", text: "T" });
      });
      await waitTick();
    } finally {
      globalThis.fetch = origFetch;
      dbInsertShouldThrow = false;
    }
  });

  it("(h-email) writes status=failed immediately when no provider is configured", async () => {
    // Unset both providers
    delete process.env["SENDGRID_API_KEY"];
    delete process.env["SMTP_HOST"];

    try {
      const { sendEmail } = await import("../lib/email.js");
      await sendEmail({
        to: "customer@example.com",
        subject: "No provider test",
        html: "<p>test</p>",
        text: "test body text",
        template: "order_receipt",
      });
      // sendEmail returns immediately (no fire-and-forget for no-provider path)
      await waitTick(10);

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"],   "failed");
      assert.equal(insertedRows[0]!["provider"], "none");
      assert.ok(
        String(insertedRows[0]!["errorMessage"]).includes("provider"),
        "errorMessage should mention missing provider",
      );
      // messageBody should store the full text, not just the subject
      assert.equal(insertedRows[0]!["messageBody"], "test body text");
    } finally {
      // Restore for subsequent tests
      process.env["SENDGRID_API_KEY"] = "SG.test-log-key";
    }
  });

  it("(i-email) messageBody stores full plain text (not just subject) so retries have complete content", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 202 });

    try {
      const { sendEmail } = await import("../lib/email.js");
      sendEmail({
        to: "customer@example.com",
        subject: "Your Ultra Clear order is confirmed",
        html: "<p>Full HTML content here</p>",
        text: "Full plain-text body of the email for retry use",
        template: "order_receipt",
      });
      await waitTick();

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"], "sent");
      // messageBody must be the full text, not the subject
      assert.equal(
        insertedRows[0]!["messageBody"],
        "Full plain-text body of the email for retry use",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ─── sendViaResend ────────────────────────────────────────────────────────────

describe("sendViaResend — notification log", () => {
  before(() => {
    process.env["RESEND_API_KEY"] = "re_test_key";
    installDbStub();
  });

  after(() => {
    delete process.env["RESEND_API_KEY"];
    restoreDbInsert();
  });

  beforeEach(() => {
    insertedRows = [];
    dbInsertShouldThrow = false;
  });

  it("(e) writes status=sent when Resend returns 200", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 });

    try {
      const { sendViaResend } = await import("../lib/resend.js");
      const ok = await sendViaResend({
        from: "Ultra Clear <noreply@contacts.ucfilters.com>",
        to: "customer@example.com",
        subject: "Your order receipt",
        text: "Thank you",
        meta: { template: "order_receipt", orderId: 7 },
      });

      assert.equal(ok, true, "sendViaResend should return true on success");
      await waitTick();

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"], "sent");
      assert.equal(insertedRows[0]!["channel"], "email");
      assert.equal(insertedRows[0]!["template"], "order_receipt");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("(f) writes status=failed when Resend returns non-2xx", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ name: "validation_error" }),
      { status: 422 },
    );

    try {
      const { sendViaResend } = await import("../lib/resend.js");
      const ok = await sendViaResend({
        from: "Ultra Clear <noreply@contacts.ucfilters.com>",
        to: "bad@example.com",
        subject: "Test",
        text: "Body",
        meta: { template: "ticket_confirmation", ticketId: "TKT-002" },
      });

      assert.equal(ok, false, "sendViaResend should return false on failure");
      await waitTick();

      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0]!["status"], "failed");
      assert.ok(
        String(insertedRows[0]!["errorMessage"]).includes("422"),
        "errorMessage should contain HTTP status",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("(g-resend) a DB insert failure does not propagate to the caller", async () => {
    dbInsertShouldThrow = true;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ id: "xyz" }), { status: 200 });

    try {
      const { sendViaResend } = await import("../lib/resend.js");
      // Must complete without throwing even though the DB insert will reject
      const ok = await sendViaResend({
        from: "noreply@contacts.ucfilters.com",
        to: "x@example.com",
        subject: "S",
        text: "T",
      });
      assert.equal(ok, true, "sendViaResend return value must not be affected by a DB error");
      await waitTick();
    } finally {
      globalThis.fetch = origFetch;
      dbInsertShouldThrow = false;
    }
  });
});
