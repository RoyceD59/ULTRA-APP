/**
 * Unit tests for the WhatsApp session drop alert system.
 *
 * Covers:
 *   1. Email template content (buildWhatsAppAlertEmail)
 *   2. Recipient parsing (alertRecipients / isAlertConfigured / qrPageUrl)
 *   3. sendSessionAlert — correct delivery, graceful no-op when
 *      UC_ADMIN_EMAILS is unset, and fallback to sendEmail when Resend fails.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppAlertEmail } from "../lib/email.js";
import {
  alertRecipients,
  isAlertConfigured,
  isCurrentQrConversion,
  qrPageUrl,
  sendSessionAlert,
} from "../lib/whatsapp.js";

// ── Email template ─────────────────────────────────────────────────────────────

describe("buildWhatsAppAlertEmail — qr reason", () => {
  const { subject, html, text } = buildWhatsAppAlertEmail({
    reason: "qr",
    qrPageUrl: "https://example.com/system-status",
  });

  it("subject contains ACTION REQUIRED", () => {
    assert.ok(
      subject.toLowerCase().includes("action required"),
      `expected 'action required' in subject, got: "${subject}"`,
    );
  });

  it("html contains the qrPageUrl", () => {
    assert.ok(html.includes("https://example.com/system-status"));
  });

  it("text contains the qrPageUrl", () => {
    assert.ok(text.includes("https://example.com/system-status"));
  });

  it("text includes a re-authenticate prompt", () => {
    assert.ok(text.includes("Re-authenticate here"), `text: ${text.slice(0, 200)}`);
  });
});

describe("buildWhatsAppAlertEmail — disconnected reason", () => {
  const { subject, html, text } = buildWhatsAppAlertEmail({
    reason: "disconnected",
    qrPageUrl: "https://example.com/system-status",
  });

  it("subject contains ALERT", () => {
    assert.ok(subject.toLowerCase().includes("alert"), `got: "${subject}"`);
  });

  it("html mentions 5-minute window", () => {
    assert.ok(html.includes("5 minutes"), `html snippet: ${html.slice(0, 300)}`);
  });

  it("text mentions 5-minute window", () => {
    assert.ok(text.includes("5 minutes"));
  });
});

// ── Recipient helpers ──────────────────────────────────────────────────────────

describe("alertRecipients", () => {
  it("returns empty array when UC_ADMIN_EMAILS is not set", () => {
    const saved = process.env["UC_ADMIN_EMAILS"];
    delete process.env["UC_ADMIN_EMAILS"];
    assert.deepEqual(alertRecipients(), []);
    if (saved !== undefined) process.env["UC_ADMIN_EMAILS"] = saved;
  });

  it("parses and lower-cases a comma-separated list", () => {
    process.env["UC_ADMIN_EMAILS"] = "Alice@EXAMPLE.com, bob@example.com , carol@example.com";
    const result = alertRecipients();
    assert.deepEqual(result, ["alice@example.com", "bob@example.com", "carol@example.com"]);
    delete process.env["UC_ADMIN_EMAILS"];
  });

  it("filters out blank entries", () => {
    process.env["UC_ADMIN_EMAILS"] = "alice@example.com,,  ";
    assert.deepEqual(alertRecipients(), ["alice@example.com"]);
    delete process.env["UC_ADMIN_EMAILS"];
  });
});

describe("isAlertConfigured", () => {
  it("returns false when UC_ADMIN_EMAILS is not set", () => {
    const saved = process.env["UC_ADMIN_EMAILS"];
    delete process.env["UC_ADMIN_EMAILS"];
    assert.equal(isAlertConfigured(), false);
    if (saved !== undefined) process.env["UC_ADMIN_EMAILS"] = saved;
  });

  it("returns false when UC_ADMIN_EMAILS is empty string", () => {
    process.env["UC_ADMIN_EMAILS"] = "";
    assert.equal(isAlertConfigured(), false);
    delete process.env["UC_ADMIN_EMAILS"];
  });

  it("returns true when at least one address is present", () => {
    process.env["UC_ADMIN_EMAILS"] = "admin@example.com";
    assert.equal(isAlertConfigured(), true);
    delete process.env["UC_ADMIN_EMAILS"];
  });
});

describe("qrPageUrl", () => {
  it("uses PROJECTHUB_URL env var when set", () => {
    process.env["PROJECTHUB_URL"] = "https://my-hub.example.com/";
    assert.equal(qrPageUrl(), "https://my-hub.example.com/system");
    delete process.env["PROJECTHUB_URL"];
  });

  it("falls back to the production default when PROJECTHUB_URL is not set", () => {
    const saved = process.env["PROJECTHUB_URL"];
    delete process.env["PROJECTHUB_URL"];
    assert.ok(qrPageUrl().endsWith("/system"), `got: ${qrPageUrl()}`);
    if (saved !== undefined) process.env["PROJECTHUB_URL"] = saved;
  });
});

// ── QR conversion ordering ────────────────────────────────────────────────────

describe("isCurrentQrConversion", () => {
  it("accepts the latest conversion in the active lifecycle", () => {
    assert.equal(isCurrentQrConversion(3, 3, 2, 2), true);
  });

  it("rejects a conversion from an older QR sequence", () => {
    assert.equal(isCurrentQrConversion(3, 3, 1, 2), false);
  });

  it("rejects a conversion from an older lifecycle generation", () => {
    assert.equal(isCurrentQrConversion(2, 3, 2, 2), false);
  });
});

// ── sendSessionAlert delivery behaviour ───────────────────────────────────────

describe("sendSessionAlert — no recipients configured", () => {
  it("returns without error and does not call any sender", async () => {
    const saved = process.env["UC_ADMIN_EMAILS"];
    delete process.env["UC_ADMIN_EMAILS"];

    const resendCalls: unknown[] = [];
    const emailCalls: unknown[] = [];

    await sendSessionAlert("qr", {
      resendSender: async (e) => { resendCalls.push(e); return true; },
      emailSender:  async (e) => { emailCalls.push(e); },
    });

    assert.equal(resendCalls.length, 0, "no Resend call when no recipients");
    assert.equal(emailCalls.length, 0, "no email call when no recipients");
    if (saved !== undefined) process.env["UC_ADMIN_EMAILS"] = saved;
  });
});

describe("sendSessionAlert — qr alert with recipients", () => {
  it("calls Resend once per recipient with an action-required subject", async () => {
    process.env["UC_ADMIN_EMAILS"] = "alice@example.com,bob@example.com";
    const resendCalls: Array<{ to: string; subject: string }> = [];

    await sendSessionAlert("qr", {
      resendSender: async (e) => { resendCalls.push(e); return true; },
      emailSender:  async () => { throw new Error("should not fall back"); },
    });

    assert.equal(resendCalls.length, 2, "one Resend call per recipient");
    const tos = resendCalls.map((c) => c.to).sort();
    assert.deepEqual(tos, ["alice@example.com", "bob@example.com"]);
    assert.ok(resendCalls[0]!.subject.toLowerCase().includes("action required"));
    delete process.env["UC_ADMIN_EMAILS"];
  });
});

describe("sendSessionAlert — disconnected alert with recipients", () => {
  it("calls Resend with an alert subject", async () => {
    process.env["UC_ADMIN_EMAILS"] = "admin@example.com";
    const resendCalls: Array<{ to: string; subject: string }> = [];

    await sendSessionAlert("disconnected", {
      resendSender: async (e) => { resendCalls.push(e); return true; },
      emailSender:  async () => { /* unused */ },
    });

    assert.equal(resendCalls.length, 1);
    assert.ok(resendCalls[0]!.subject.toLowerCase().includes("alert"), `subject: ${resendCalls[0]!.subject}`);
    delete process.env["UC_ADMIN_EMAILS"];
  });
});

describe("sendSessionAlert — Resend failure triggers sendEmail fallback", () => {
  it("calls emailSender when Resend returns false", async () => {
    process.env["UC_ADMIN_EMAILS"] = "admin@example.com";
    const emailCalls: Array<{ to: string }> = [];

    await sendSessionAlert("qr", {
      resendSender: async () => false,          // simulate Resend failure
      emailSender:  async (e) => { emailCalls.push(e); },
    });

    // Fire-and-forget: allow one microtick for the void call to execute
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(emailCalls.length, 1, "emailSender fallback should have been called");
    assert.equal(emailCalls[0]!.to, "admin@example.com");
    delete process.env["UC_ADMIN_EMAILS"];
  });
});

describe("sendSessionAlert — Resend throws triggers sendEmail fallback", () => {
  it("calls emailSender when Resend throws", async () => {
    process.env["UC_ADMIN_EMAILS"] = "admin@example.com";
    const emailCalls: Array<{ to: string }> = [];

    await sendSessionAlert("qr", {
      resendSender: async () => { throw new Error("network error"); },
      emailSender:  async (e) => { emailCalls.push(e); },
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(emailCalls.length, 1, "emailSender fallback should be called on Resend throw");
    delete process.env["UC_ADMIN_EMAILS"];
  });
});
