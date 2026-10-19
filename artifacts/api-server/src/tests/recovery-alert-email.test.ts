import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendRecoveryAlertEmail } from "../lib/recovery-alert-email.js";
import type { ResendEmail } from "../lib/resend.js";

const email = {
  from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
  to: "info@ucfilters.com",
  subject: "Recovery order needs fulfilment",
  text: "Private customer details",
  meta: { template: "payment_recovery_alert", orderId: 123 },
};

function harness() {
  const waits: number[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    waits, warnings, errors,
    dependencies: {
      wait: async (ms: number) => { waits.push(ms); },
      warn: (message: string) => { warnings.push(message); },
      error: (message: string) => { errors.push(message); },
    },
  };
}

describe("Recovery alert email retry", () => {
  it("sends only once when Resend accepts immediately", async () => {
    const h = harness();
    const calls: ResendEmail[] = [];
    assert.equal(await sendRecoveryAlertEmail(email, async (message) => {
      calls.push(message);
      return true;
    }, h.dependencies), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(h.waits, []);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.warnings, []);
  });

  it("retries a false result after a short backoff using the same email and provider key", async () => {
    const h = harness();
    const calls: ResendEmail[] = [];
    assert.equal(await sendRecoveryAlertEmail(email, async (message) => {
      calls.push(message);
      return calls.length === 2;
    }, h.dependencies), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(h.waits, [1_000]);
    assert.equal(h.warnings.length, 1);
    assert.deepEqual(h.errors, []);
    assert.ok(calls[0]!.idempotencyKey);
    assert.equal(calls[0]!.idempotencyKey, calls[1]!.idempotencyKey);
    for (const call of calls) {
      assert.equal(call.to, email.to);
      assert.equal(call.text, email.text);
      assert.deepEqual(call.meta, email.meta);
      assert.ok(call.signal instanceof AbortSignal);
    }
    assert.notEqual(calls[0]!.signal, calls[1]!.signal, "Each attempt gets a fresh deadline");
  });

  it("retries an unexpected rejection without leaking provider error details", async () => {
    const h = harness();
    let attempts = 0;
    assert.equal(await sendRecoveryAlertEmail(email, async () => {
      if (++attempts === 1) throw new Error("private provider details");
      return true;
    }, h.dependencies), true);
    assert.equal(attempts, 2);
    assert.deepEqual(h.waits, [1_000]);
    assert.ok(!h.warnings.join("").includes("private provider details"));
  });

  it("stops after two failures and logs an actionable error without customer details", async () => {
    const h = harness();
    let attempts = 0;
    assert.equal(await sendRecoveryAlertEmail(email, async () => {
      attempts++;
      return false;
    }, h.dependencies), false);
    assert.equal(attempts, 2);
    assert.deepEqual(h.waits, [1_000]);
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0]!, /RECOVERY_ALERT_EMAIL_FAILED.*orderId=123/);
    assert.match(h.errors[0]!, /manual fulfilment/);
    assert.ok(!h.errors[0]!.includes(email.text));
    assert.ok(!h.errors[0]!.includes(email.to));
  });

  it("also reports two rejected attempts instead of dropping the alert silently", async () => {
    const h = harness();
    let attempts = 0;
    assert.equal(await sendRecoveryAlertEmail(email, async () => {
      attempts++;
      throw new Error("provider unavailable");
    }, h.dependencies), false);
    assert.equal(attempts, 2);
    assert.equal(h.errors.length, 1);
  });
});