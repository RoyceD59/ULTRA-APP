/**
 * Dual-failure registration alert tests.
 *
 * Verifies that when both the DB insert and the backup folder write fail
 * during registration, an alert (Resend email via notifyOffice) is fired
 * that includes the customer's email and phone number.
 *
 * Run with: pnpm --filter @workspace/api-server test
 *
 * Test strategy:
 *   - Spin up a stub Resend HTTP server (like office-notify.test.ts).
 *   - Force db.insert to throw ("DB down").
 *   - Force _ioSeams.appendFile to throw ("disk full").
 *   - POST to /api/uc/auth/register and confirm the stub received a payload
 *     whose body contains both the customer email and phone.
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
const { db } = await import("@workspace/db");
// mock is the node:test built-in
import { mock } from "node:test";

// ── Stub Resend server (captures outgoing notifyOffice payloads) ──────────────
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "stub" }));
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Dual-failure registration alert", () => {
  beforeEach(() => {
    resendHits = [];
  });

  it("fires a Resend alert with customer email and phone when both DB and folder write fail", async () => {
    const customerEmail = "dual-alert-customer@test.com";
    const customerPhone = "+254712000099";

    // Simulate DB failure.
    const insertMock = mock.method(db, "insert", () => {
      throw new Error("DB_DOWN_SIMULATION");
    });

    // Simulate disk full — folder write also fails.
    const realAppendFile = _ioSeams.appendFile;
    _ioSeams.appendFile = async () => {
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    };

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
      insertMock.mock.restore();
      _ioSeams.appendFile = realAppendFile;
    }
  });
});
