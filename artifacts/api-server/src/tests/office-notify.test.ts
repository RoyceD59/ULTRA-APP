/**
 * Tests for notifyOffice() — office inbox copies of water-test / service forms.
 *
 * Verifies:
 *   1. Resend 2xx → delivered, no fallback attempted.
 *   2. Resend non-2xx → falls back to the SendGrid/SMTP chain (sendEmail).
 *   3. No provider configured → resolves without throwing, and the customer
 *      form payload (PII) is never written to the logs.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env["SESSION_SECRET"] ??= "test-secret-for-office-notify-tests";

const { notifyOffice } = await import("../routes/uc.js");
const { _slackSeams } = await import("../lib/slack.js");

// ── Stub Resend server ───────────────────────────────────────────────────────
let resendStub: http.Server;
let resendStatus = 200;
let resendHits: { subject?: string; to?: string }[] = [];

before(async () => {
  resendStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resendHits.push(JSON.parse(body)); } catch { resendHits.push({}); }
      res.writeHead(resendStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resendStatus < 300 ? { id: "stub" } : { error: "stub failure" }));
    });
  });
  await new Promise<void>((r) => resendStub.listen(0, () => r()));
  const addr = resendStub.address();
  if (typeof addr === "object" && addr) {
    process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${addr.port}`;
  }
});

after(async () => {
  _slackSeams.sendMessage = null;
  await new Promise<void>((r) => resendStub.close(() => r()));
  delete process.env["RESEND_BASE_URL"];
  delete process.env["RESEND_API_KEY"];
});

function captureConsole(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const orig = { log: console.log, info: console.info, error: console.error, warn: console.warn };
  const push = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  console.log = push; console.info = push; console.error = push; console.warn = push;
  return { logs, restore: () => { Object.assign(console, orig); } };
}

const PII_LINES = [
  "Name:    Jane Private",
  "Phone:   +254700000001",
  "Address: 42 Hidden Lane, Nairobi",
];

describe("notifyOffice", () => {
  beforeEach(() => {
    resendHits = [];
    _slackSeams.sendMessage = null;
  });

  it("delivers via Resend on 2xx and does not fall back", async () => {
    process.env["RESEND_API_KEY"] = "test-key";
    resendStatus = 200;
    const cap = captureConsole();
    try {
      await notifyOffice("Test subject A", PII_LINES);
    } finally { cap.restore(); }
    assert.equal(resendHits.length, 1);
    assert.equal(resendHits[0]?.to, "sales@ucfilters.com");
    assert.equal(resendHits[0]?.subject, "Test subject A");
    assert.ok(!cap.logs.some((l) => l.includes("falling back")), "no fallback on 2xx");
  });

  it("falls back to SendGrid/SMTP chain when Resend returns non-2xx", async () => {
    process.env["RESEND_API_KEY"] = "test-key";
    resendStatus = 500;
    const cap = captureConsole();
    try {
      await notifyOffice("Test subject B", PII_LINES);
    } finally { cap.restore(); }
    assert.equal(resendHits.length, 1, "Resend was attempted");
    assert.ok(cap.logs.some((l) => l.includes("falling back")), "fallback logged");
    // sendEmail chain reached (no provider configured in tests → skip log)
    assert.ok(cap.logs.some((l) => l.includes("sales@ucfilters.com")), "sendEmail fallback attempted");
  });

  it("attempts Slack for a ticket alert when Resend returns non-2xx", async () => {
    process.env["RESEND_API_KEY"] = "test-key";
    resendStatus = 500;
    const slackCalls: Array<{ text: string; template: string }> = [];
    _slackSeams.sendMessage = async (text, template) => {
      slackCalls.push({ text, template });
      return true;
    };

    const subject = "New Service Request TKT-SLACK-1: Sweet Home";
    await notifyOffice(subject, PII_LINES, { ticketId: "TKT-SLACK-1" });

    assert.equal(resendHits.length, 1, "Resend was attempted");
    assert.equal(slackCalls.length, 1, "Slack fallback was attempted");
    assert.equal(slackCalls[0]?.template, "OFFICE_NOTIFICATION_RESEND_FAILURE");
    assert.match(slackCalls[0]?.text ?? "", /TKT-SLACK-1/);
  });

  it("never logs the customer form payload (PII)", async () => {
    delete process.env["RESEND_API_KEY"];
    const cap = captureConsole();
    try {
      await notifyOffice("Test subject C", PII_LINES);
    } finally { cap.restore(); }
    const all = cap.logs.join("\n");
    assert.ok(!all.includes("Jane Private"), "name not logged");
    assert.ok(!all.includes("+254700000001"), "phone not logged");
    assert.ok(!all.includes("42 Hidden Lane"), "address not logged");
  });
});
