/**
 * Integration tests for the account-deletion team notification
 * (DELETE /api/uc/customer, step 15).
 *
 * Verifies:
 *   1. The alert is dispatched after a customer account is deleted.
 *   2. The alert subject and body contain no PII — only the numeric user ID
 *      and a UTC timestamp.  (Right-to-erasure constraint.)
 *
 * Strategy:
 *   - Spin up a stub Resend HTTP server (RESEND_BASE_URL / RESEND_API_KEY).
 *   - Seed a real uc_users row with a known name, email, and phone.
 *   - DELETE /api/uc/customer with a valid JWT.
 *   - Wait briefly for the fire-and-forget notification, then inspect captures.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Isolated data dir so JSONL scrub attempts don't fail noisily ──────────────
const dataDir = await mkdtemp(join(tmpdir(), "uc-deletion-notif-"));
process.env["UC_ACCOUNTS_DATA_DIR"] = dataDir;
process.env["SESSION_SECRET"] ??= "test-secret-for-deletion-notification-tests";

// ── Resend stub — captures every outgoing sendViaResend payload ───────────────
let resendStub: http.Server;
let resendHits: Array<Record<string, unknown>> = [];
let resendStatus = 200;

before(async () => {
  resendStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resendHits.push(JSON.parse(body) as Record<string, unknown>); }
      catch  { resendHits.push({}); }
      res.writeHead(resendStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "stub-deletion-notif" }));
    });
  });
  await new Promise<void>((r) => resendStub.listen(0, "127.0.0.1", () => r()));
  const addr = resendStub.address() as { port: number };
  process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${addr.port}`;
  process.env["RESEND_API_KEY"]  = "test-key";
});

after(async () => {
  await new Promise<void>((r) => resendStub.close(() => r()));
  delete process.env["RESEND_BASE_URL"];
  delete process.env["RESEND_API_KEY"];
  await rm(dataDir, { recursive: true, force: true });
});

// ── App + helpers (imported after env vars are set) ───────────────────────────
const { default: app }  = await import("../app.js");
const { issueToken }    = await import("../lib/jwt.js");
const { pool }          = await import("@workspace/db");
const { notifyTeamAccountDeletion } = await import("../routes/uc.js");
const { _slackSeams } = await import("../lib/slack.js");

let appServer: http.Server;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    appServer = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    appServer.close((e) => (e ? reject(e) : resolve()));
  });
});

// ── Utilities ─────────────────────────────────────────────────────────────────

async function doDelete(token: string): Promise<{ status: number; body: unknown }> {
  const { port } = appServer.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${port}/api/uc/customer`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

interface SeededUser {
  id:        number;
  email:     string;
  phone:     string;
  firstName: string;
}

async function seedUser(tag: string): Promise<SeededUser> {
  const email     = `deletion-notif-${tag}@example.com`;
  const phone     = "+254700000099";
  const firstName = "PiiAlice";
  const r = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, 'x', $2, 'PiiTester', $3) RETURNING id`,
    [email, firstName, phone],
  );
  return { id: r.rows[0]!.id, email, phone, firstName };
}

async function cleanupUser(id: number): Promise<void> {
  await pool.query("DELETE FROM uc_users WHERE id = $1", [id]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("account-deletion team notification (DELETE /api/uc/customer, step 15)", () => {
  it("alert subject and body contain no PII — only the numeric user ID and timestamp", async () => {
    resendHits = [];
    const user  = await seedUser(`${Date.now()}-d`);
    const token = issueToken({ id: user.id, email: user.email });
    try {
      const { status } = await doDelete(token);
      assert.equal(status, 200);

      await new Promise((r) => setTimeout(r, 500));

      assert.ok(resendHits.length >= 1, "Expected at least one Resend call");

      // Inspect every captured Resend payload (subject, text, html).
      for (const hit of resendHits) {
        const subject = String(hit["subject"] ?? "");
        const text    = String(hit["text"]    ?? "");
        const html    = String(hit["html"]    ?? "");

        for (const field of [subject, text, html]) {
          assert.ok(
            !field.includes(user.email),
            `Customer email "${user.email}" must not appear in the alert (field: ${field})`,
          );
          assert.ok(
            !field.includes(user.phone),
            `Customer phone "${user.phone}" must not appear in the alert (field: ${field})`,
          );
          assert.ok(
            !field.includes(user.firstName),
            `Customer name "${user.firstName}" must not appear in the alert (field: ${field})`,
          );
        }

        // Sanity: the numeric user ID must appear in subject or body.
        const fullPayload = subject + text + html;
        assert.ok(
          fullPayload.includes(String(user.id)),
          `Alert must include the numeric user ID ${user.id} (payload: ${fullPayload})`,
        );
      }
    } finally {
      await cleanupUser(user.id);
    }
  });

  it("logs a warning and tries the fallback when Resend returns false", async () => {
    const warnings: Array<{ details: Record<string, unknown>; message: string }> = [];
    const fallbackCalls: Array<{ to: string; template?: string }> = [];

    await notifyTeamAccountDeletion(
      987,
      "Sat, 12 Sep 2026 10:00:00 GMT",
      "team@example.com",
      {
        resendSender: async () => false,
        fallbackSender: async (email) => {
          fallbackCalls.push({ to: email.to, template: email.template });
          return true;
        },
        warn: (details, message) => warnings.push({ details, message }),
      },
    );

    assert.equal(fallbackCalls.length, 1);
    assert.deepEqual(fallbackCalls[0], {
      to: "team@example.com",
      template: "account_deleted",
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!.message, /not sent via Resend/i);
    assert.equal(warnings[0]!.details["provider"], "resend");
  });

  it("still completes deletion when Resend is temporarily unavailable", async () => {
    resendHits = [];
    resendStatus = 503;
    const slackHits: Array<{ text: string; template: string }> = [];
    _slackSeams.sendMessage = async (text, template) => {
      slackHits.push({ text, template });
      return true;
    };
    const user = await seedUser(`${Date.now()}-outage`);
    const token = issueToken({ id: user.id, email: user.email });
    try {
      const { status, body } = await doDelete(token);
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true });

      await new Promise((r) => setTimeout(r, 500));
      assert.ok(resendHits.length >= 1, "Expected the failed Resend attempt");
      assert.equal(slackHits.length, 1, "Slack must receive the alert when all email paths are unavailable");
      assert.equal(slackHits[0]!.template, "account_deleted");
      assert.match(slackHits[0]!.text, new RegExp(`user #${user.id}`));
      assert.ok(!slackHits[0]!.text.includes(user.email), "Slack fallback must not contain customer PII");

      const deleted = await pool.query<{ deleted_at: Date | null }>(
        "SELECT deleted_at FROM uc_users WHERE id = $1",
        [user.id],
      );
      assert.ok(deleted.rows[0]?.deleted_at, "Account deletion must remain committed");
    } finally {
      _slackSeams.sendMessage = null;
      resendStatus = 200;
      await cleanupUser(user.id);
    }
  });
});
