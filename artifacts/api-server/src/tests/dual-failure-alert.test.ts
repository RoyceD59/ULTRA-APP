/**
 * Dual-failure registration alert tests.
 *
 * Verifies that when both the DB insert and the backup folder write fail
 * during registration:
 *   1. A Resend alert (via notifyOffice) fires with the customer's details.
 *   2. When Resend is also non-2xx the Slack alert is still attempted.
 *   3. When both Resend and Slack fail the endpoint still returns 503 cleanly.
 *
 * Run with: pnpm --filter @workspace/api-server test
 *
 * Test strategy:
 *   - Spin up a configurable stub Resend HTTP server.
 *   - Force db.transaction to throw ("DB down").
 *   - Force _ioSeams.appendFile to throw ("disk full").
 *   - Intercept Slack via _slackSeams.sendMessage to capture or fail calls.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Isolated data dir so the folder write attempt doesn't bleed into other tests.
const dataDir = await mkdtemp(join(tmpdir(), "uc-dual-fail-alert-"));
process.env["UC_ACCOUNTS_DATA_DIR"] = dataDir;
process.env["SESSION_SECRET"] ??= "test-secret-for-dual-failure-alert-tests";

// ── Import app and internals after setting env vars.
const { default: app } = await import("../app.js");
const { _ioSeams } = await import("../lib/account-records.js");
const { _slackSeams } = await import("../lib/slack.js");
const { db } = await import("@workspace/db");
// mock is the node:test built-in
import { mock } from "node:test";

// ── Configurable stub Resend server ──────────────────────────────────────────
// resendMode controls what the stub returns for each test.
let resendMode: "ok" | "error" = "ok";
let resendStub: http.Server;
let resendHits: Array<Record<string, unknown>> = [];

before(async () => {
  resendStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resendHits.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        resendHits.push({});
      }
      if (resendMode === "ok") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "stub" }));
      } else {
        // Simulate Resend being down — return a non-2xx status.
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "service_unavailable" }));
      }
    });
  });
  await new Promise<void>((r) => resendStub.listen(0, () => r()));
  const addr = resendStub.address();
  if (typeof addr === "object" && addr) {
    process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${addr.port}`;
    process.env["RESEND_API_KEY"]  = "test-key";
  }
});

after(async () => {
  await new Promise<void>((r) => resendStub.close(() => r()));
  delete process.env["RESEND_BASE_URL"];
  delete process.env["RESEND_API_KEY"];
  await rm(dataDir, { recursive: true, force: true });
});

// ── HTTP helper ───────────────────────────────────────────────────────────────
let server: http.Server;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((e) => (e ? reject(e) : resolve()));
  });
});

async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ── Shared helper: force both DB and folder to fail ──────────────────────────
function simulateDualFailure() {
  const transactionMock = mock.method(db, "transaction", () => {
    throw new Error("DB_DOWN_SIMULATION");
  });
  const realAppendFile = _ioSeams.appendFile;
  _ioSeams.appendFile = async () => {
    throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  };
  return {
    restore() {
      transactionMock.mock.restore();
      _ioSeams.appendFile = realAppendFile;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Dual-failure registration alert", () => {
  beforeEach(() => {
    resendHits = [];
    resendMode = "ok";
    _slackSeams.sendMessage = null; // reset to live path between tests
  });

  it("fires a Resend alert with customer email and phone when both DB and folder write fail", async () => {
    const customerEmail = "dual-alert-customer@test.com";
    const customerPhone = "+254712000099";

    const sim = simulateDualFailure();
    try {
      const { status, body } = await post("/api/uc/auth/register", {
        email:     customerEmail,
        phone:     customerPhone,
        password:  "test-pass-dual-alert",
        firstName: "Alert",
        lastName:  "Test",
      });

      // Must still return a proper 503 — the alert must never change HTTP behaviour.
      assert.equal(status, 503, `expected 503 but got ${status}`);
      assert.ok(!body["token"], "503 must not include a session token");

      // Allow notifyOffice (fire-and-forget) to complete.
      await new Promise((r) => setTimeout(r, 400));

      // At least one Resend call must carry the customer's email and phone.
      assert.ok(
        resendHits.length >= 1,
        `expected at least 1 Resend call, got ${resendHits.length}`,
      );

      const alertHit = resendHits.find((h) => {
        const text = JSON.stringify(h);
        return text.includes(customerEmail) && text.includes(customerPhone);
      });
      assert.ok(
        alertHit !== undefined,
        `No Resend payload contained both "${customerEmail}" and "${customerPhone}". ` +
          `Captured payloads: ${JSON.stringify(resendHits, null, 2)}`,
      );
    } finally {
      sim.restore();
    }
  });

  it("still attempts the Slack alert when Resend returns non-2xx during a dual failure", async () => {
    const customerEmail = "dual-alert-slack-fallback@test.com";
    const customerPhone = "+254712000098";

    // Make Resend return 503 for this test.
    resendMode = "error";

    // Capture Slack calls via the seam.
    const slackCalls: Array<{ text: string; template: string }> = [];
    _slackSeams.sendMessage = async (text, template) => {
      slackCalls.push({ text, template });
      return false; // simulate Slack also failing — we only need to confirm it was attempted
    };

    const sim = simulateDualFailure();
    try {
      const { status, body } = await post("/api/uc/auth/register", {
        email:     customerEmail,
        phone:     customerPhone,
        password:  "test-pass-slack-fallback",
        firstName: "Slack",
        lastName:  "Fallback",
      });

      assert.equal(status, 503, `expected 503 but got ${status}`);
      assert.ok(!body["token"], "503 must not include a session token");

      // Allow fire-and-forget alerts to settle.
      await new Promise((r) => setTimeout(r, 400));

      // The Slack leg must fire regardless of the Resend outcome.
      assert.ok(
        slackCalls.length >= 1,
        `expected at least 1 Slack attempt, got ${slackCalls.length}`,
      );

      // The Slack message must reference the customer's identifiers.
      const slackHit = slackCalls.find(
        (c) => c.text.includes(customerEmail) && c.text.includes(customerPhone),
      );
      assert.ok(
        slackHit !== undefined,
        `No Slack call contained both "${customerEmail}" and "${customerPhone}". ` +
          `Captured calls: ${JSON.stringify(slackCalls, null, 2)}`,
      );
    } finally {
      sim.restore();
      _slackSeams.sendMessage = null;
    }
  });

  it("returns 503 cleanly when both Resend and Slack fail during a dual failure", async () => {
    const customerEmail = "dual-alert-all-fail@test.com";
    const customerPhone = "+254712000097";

    // Both transports fail.
    resendMode = "error";
    _slackSeams.sendMessage = async () => {
      throw new Error("SLACK_DOWN_SIMULATION");
    };

    const sim = simulateDualFailure();
    try {
      const { status, body } = await post("/api/uc/auth/register", {
        email:     customerEmail,
        phone:     customerPhone,
        password:  "test-pass-all-fail",
        firstName: "Total",
        lastName:  "Failure",
      });

      // The HTTP response must always be 503 — alert failures must not bubble up.
      assert.equal(status, 503, `expected 503 but got ${status}`);
      assert.ok(!body["token"], "503 must not include a session token");
      assert.ok(
        typeof body["error"] === "string" && body["error"].length > 0,
        "503 body must carry a human-readable error message",
      );

      // Give fire-and-forget tasks time to settle (and swallow errors).
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      sim.restore();
      _slackSeams.sendMessage = null;
    }
  });
});
