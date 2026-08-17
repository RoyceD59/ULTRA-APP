/**
 * Tests for sendSms failure logging for customer-facing SMS templates.
 *
 * Covers that when Africa's Talking rejects or is unreachable, the
 * uc_notification_log row for order/ticket/water-test messages is written with
 * the correct fields:
 *   – recipient  : normalised E.164 phone
 *   – template   : the template name passed in meta
 *   – channel    : "sms"
 *   – provider   : "africas_talking"
 *   – orderId / ticketId / testId : matching the caller-supplied metadata
 *   – status     : "failed"
 *
 * Scenarios tested (three per template):
 *   (1-order)  AT returns HTTP 401 while sending an order-confirmation SMS
 *   (2-order)  AT throws a network error while sending an order-confirmation SMS
 *   (3-order)  AT credentials absent → no-op path still logs status=failed with meta
 *   (1-ticket) AT returns HTTP 500 while sending a ticket-confirmation SMS
 *   (2-ticket) AT throws a network error while sending a ticket-confirmation SMS
 *   (3-ticket) AT credentials absent → no-op path still logs status=failed with meta
 *   (1-test)   AT returns HTTP 401 while sending a water-test-confirmation SMS
 *   (2-test)   AT throws a network error while sending a water-test-confirmation SMS
 *   (3-test)   AT credentials absent → no-op path still logs status=failed with meta
 *
 * Strategy:
 *   – db.insert is monkey-patched to capture log rows without hitting the DB.
 *   – globalThis.fetch is replaced per-test to simulate AT failure modes.
 *   – sendSms is imported directly from lib/sms.ts so the test is independent
 *     of any route module.
 *   – No real HTTP server or database rows are required.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── DB insert monkey-patch ───────────────────────────────────────────────────
// Must be installed before lib/sms.ts is imported so the same db object is
// patched when logSmsAttempt runs.

import { db } from "@workspace/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalInsert = (db as any).insert.bind(db);

/** Rows captured by the insert stub — reset before each test. */
let capturedInserts: unknown[] = [];

function installInsertStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (_table: unknown) => ({
    values: (vals: unknown) => {
      capturedInserts.push(vals);
      return { catch: () => {} };
    },
  });
}

function restoreInsert(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = originalInsert;
}

// ─── fetch capture helper ─────────────────────────────────────────────────────

let realFetch: typeof globalThis.fetch;

function waitTick(ms = 80): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Helper: find a failed SMS log row ───────────────────────────────────────

function findFailedSmsRow(): Record<string, unknown> | undefined {
  return capturedInserts.find((row) => {
    const r = row as Record<string, unknown>;
    return r["channel"] === "sms" && r["status"] === "failed";
  }) as Record<string, unknown> | undefined;
}

// ─── Shared assertions ────────────────────────────────────────────────────────

function assertCommonFields(
  logRow: Record<string, unknown>,
  expectedPhone: string,
  expectedTemplate: string,
): void {
  assert.equal(
    logRow["recipient"],
    expectedPhone,
    `recipient should be normalised E.164; got: ${logRow["recipient"]}`,
  );
  assert.equal(
    logRow["template"],
    expectedTemplate,
    `template should match meta.template; got: ${logRow["template"]}`,
  );
  assert.equal(logRow["channel"], "sms", `channel should be "sms"; got: ${logRow["channel"]}`);
  assert.equal(
    logRow["provider"],
    "africas_talking",
    `provider should be "africas_talking"; got: ${logRow["provider"]}`,
  );
  assert.equal(logRow["status"], "failed", `status should be "failed"; got: ${logRow["status"]}`);
}

// ─── Import the module under test ─────────────────────────────────────────────
// Imported once here; ESM cache ensures the same sendSms sees the patched db.

import { sendSms, orderConfirmationSms, ticketConfirmationSms, waterTestConfirmationSms } from "../lib/sms.js";

// =============================================================================
// Order-confirmation SMS failures
// =============================================================================

describe("sendSms — order-confirmation template failure logging", () => {
  before(() => {
    installInsertStub();
    realFetch = globalThis.fetch;
  });

  after(() => {
    restoreInsert();
    globalThis.fetch = realFetch;
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];
  });

  beforeEach(() => {
    capturedInserts = [];
    globalThis.fetch = realFetch; // reset to real between tests
  });

  it("(1-order) AT returning 401 logs status=failed with correct fields and orderId", async () => {
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("africastalking.com")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return savedFetch(input, _init);
    };

    const phone   = "0712345001";
    const orderId = 1001;
    const message = orderConfirmationSms({ orderId, total: "3500", firstName: "Alice" });

    await sendSms(phone, message, { template: "order_confirmation", orderId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254712345001", "order_confirmation");
    assert.equal(
      logRow["orderId"],
      orderId,
      `orderId should be ${orderId}; got: ${logRow["orderId"]}`,
    );
    assert.ok(
      String(logRow["errorMessage"] ?? "").includes("401"),
      `errorMessage should reference 401; got: ${logRow["errorMessage"]}`,
    );
  });

  it("(2-order) AT network error logs status=failed with correct fields and orderId", async () => {
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";

    globalThis.fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("africastalking.com")) {
        throw new Error("Simulated network failure");
      }
      throw new Error("Unexpected fetch call");
    };

    const phone   = "0712345002";
    const orderId = 1002;
    const message = orderConfirmationSms({ orderId, total: "5000", firstName: "Bob" });

    await sendSms(phone, message, { template: "order_confirmation", orderId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254712345002", "order_confirmation");
    assert.equal(
      logRow["orderId"],
      orderId,
      `orderId should be ${orderId}; got: ${logRow["orderId"]}`,
    );
    assert.ok(
      String(logRow["errorMessage"] ?? "").toLowerCase().includes("network"),
      `errorMessage should mention network error; got: ${logRow["errorMessage"]}`,
    );
  });

  it("(3-order) missing AT credentials logs status=failed with correct fields and orderId", async () => {
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];

    const phone   = "0712345003";
    const orderId = 1003;
    const message = orderConfirmationSms({ orderId, total: "2000", firstName: "Carol" });

    await sendSms(phone, message, { template: "order_confirmation", orderId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254712345003", "order_confirmation");
    assert.equal(
      logRow["orderId"],
      orderId,
      `orderId should be ${orderId}; got: ${logRow["orderId"]}`,
    );
  });
});

// =============================================================================
// Ticket-confirmation SMS failures
// =============================================================================

describe("sendSms — ticket-confirmation template failure logging", () => {
  before(() => {
    installInsertStub();
    realFetch = globalThis.fetch;
  });

  after(() => {
    restoreInsert();
    globalThis.fetch = realFetch;
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];
  });

  beforeEach(() => {
    capturedInserts = [];
    globalThis.fetch = realFetch;
  });

  it("(1-ticket) AT returning 500 logs status=failed with correct fields and ticketId", async () => {
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("africastalking.com")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return savedFetch(input, _init);
    };

    const phone    = "0722000001";
    const ticketId = "TKT-2001";
    const message  = ticketConfirmationSms({ ticketId, firstName: "David" });

    await sendSms(phone, message, { template: "ticket_confirmation", ticketId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254722000001", "ticket_confirmation");
    assert.equal(
      logRow["ticketId"],
      ticketId,
      `ticketId should be ${ticketId}; got: ${logRow["ticketId"]}`,
    );
    assert.ok(
      String(logRow["errorMessage"] ?? "").includes("500"),
      `errorMessage should reference 500; got: ${logRow["errorMessage"]}`,
    );
  });

  it("(2-ticket) AT network error logs status=failed with correct fields and ticketId", async () => {
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";

    globalThis.fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("africastalking.com")) {
        throw new Error("Simulated network failure");
      }
      throw new Error("Unexpected fetch call");
    };

    const phone    = "0722000002";
    const ticketId = "TKT-2002";
    const message  = ticketConfirmationSms({ ticketId, firstName: "Eve" });

    await sendSms(phone, message, { template: "ticket_confirmation", ticketId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254722000002", "ticket_confirmation");
    assert.equal(
      logRow["ticketId"],
      ticketId,
      `ticketId should be ${ticketId}; got: ${logRow["ticketId"]}`,
    );
    assert.ok(
      String(logRow["errorMessage"] ?? "").toLowerCase().includes("network"),
      `errorMessage should mention network error; got: ${logRow["errorMessage"]}`,
    );
  });

  it("(3-ticket) missing AT credentials logs status=failed with correct fields and ticketId", async () => {
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];

    const phone    = "0722000003";
    const ticketId = "TKT-2003";
    const message  = ticketConfirmationSms({ ticketId, firstName: "Frank" });

    await sendSms(phone, message, { template: "ticket_confirmation", ticketId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254722000003", "ticket_confirmation");
    assert.equal(
      logRow["ticketId"],
      ticketId,
      `ticketId should be ${ticketId}; got: ${logRow["ticketId"]}`,
    );
  });
});

// =============================================================================
// Water-test-confirmation SMS failures
// =============================================================================

describe("sendSms — water-test-confirmation template failure logging", () => {
  before(() => {
    installInsertStub();
    realFetch = globalThis.fetch;
  });

  after(() => {
    restoreInsert();
    globalThis.fetch = realFetch;
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];
  });

  beforeEach(() => {
    capturedInserts = [];
    globalThis.fetch = realFetch;
  });

  it("(1-test) AT returning 401 logs status=failed with correct fields and testId", async () => {
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("africastalking.com")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return savedFetch(input, _init);
    };

    const phone   = "0733000001";
    const testId  = "WT-3001";
    const message = waterTestConfirmationSms({
      testId,
      address: "123 Nairobi Road, Westlands",
      firstName: "Grace",
    });

    await sendSms(phone, message, { template: "water_test_confirmation", testId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254733000001", "water_test_confirmation");
    assert.equal(
      logRow["testId"],
      testId,
      `testId should be ${testId}; got: ${logRow["testId"]}`,
    );
    assert.ok(
      String(logRow["errorMessage"] ?? "").includes("401"),
      `errorMessage should reference 401; got: ${logRow["errorMessage"]}`,
    );
  });

  it("(2-test) AT network error logs status=failed with correct fields and testId", async () => {
    process.env["AT_API_KEY"]  = "test-at-key";
    process.env["AT_USERNAME"] = "sandbox";

    globalThis.fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("africastalking.com")) {
        throw new Error("Simulated network failure");
      }
      throw new Error("Unexpected fetch call");
    };

    const phone   = "0733000002";
    const testId  = "WT-3002";
    const message = waterTestConfirmationSms({
      testId,
      address: "456 Mombasa Road, Karen",
      firstName: "Helen",
    });

    await sendSms(phone, message, { template: "water_test_confirmation", testId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254733000002", "water_test_confirmation");
    assert.equal(
      logRow["testId"],
      testId,
      `testId should be ${testId}; got: ${logRow["testId"]}`,
    );
    assert.ok(
      String(logRow["errorMessage"] ?? "").toLowerCase().includes("network"),
      `errorMessage should mention network error; got: ${logRow["errorMessage"]}`,
    );
  });

  it("(3-test) missing AT credentials logs status=failed with correct fields and testId", async () => {
    delete process.env["AT_API_KEY"];
    delete process.env["AT_USERNAME"];

    const phone   = "0733000003";
    const testId  = "WT-3003";
    const message = waterTestConfirmationSms({
      testId,
      address: "789 Thika Road, Kasarani",
      firstName: "Ivan",
    });

    await sendSms(phone, message, { template: "water_test_confirmation", testId });
    await waitTick();

    const logRow = findFailedSmsRow();
    assert.ok(
      logRow,
      `Expected a status=failed SMS log row; captured: ${JSON.stringify(capturedInserts)}`,
    );
    assertCommonFields(logRow, "+254733000003", "water_test_confirmation");
    assert.equal(
      logRow["testId"],
      testId,
      `testId should be ${testId}; got: ${logRow["testId"]}`,
    );
  });
});
