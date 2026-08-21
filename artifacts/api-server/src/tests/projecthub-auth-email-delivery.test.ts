/**
 * ProjectHub invitation and admin-reset delivery contracts.
 *
 * Uses a local Resend stub so both acceptance and failure remain deterministic.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env["SESSION_SECRET"] ??= "projecthub-auth-email-test-secret";

let resendStub: http.Server;
let resendStatus = 200;
let resendHits: Array<Record<string, unknown>> = [];
let resendLastEvent = "email.delivered";

before(async () => {
  resendStub = http.createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ last_event: resendLastEvent }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      resendHits.push(JSON.parse(body) as Record<string, unknown>);
      res.writeHead(resendStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resendStatus < 300 ? { id: "resend-stub" } : { name: "validation_error" }));
    });
  });
  await new Promise<void>((resolve) => resendStub.listen(0, "127.0.0.1", resolve));
  const { port } = resendStub.address() as { port: number };
  process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${port}`;
  process.env["RESEND_API_KEY"] = "test-key";
});

after(async () => {
  await new Promise<void>((resolve, reject) => resendStub.close((err) => err ? reject(err) : resolve()));
  delete process.env["RESEND_BASE_URL"];
  delete process.env["RESEND_API_KEY"];
});

const { default: app } = await import("../app.js");
const { issueToken } = await import("../lib/jwt.js");
const { pool } = await import("@workspace/db");

let appServer: http.Server;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    appServer = app.listen(0, "127.0.0.1", (err?: Error) => err ? reject(err) : resolve());
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => appServer.close((err) => err ? reject(err) : resolve()));
});

function adminToken(): string {
  return issueToken({
    id: "projecthub-email-admin",
    email: "projecthub-email-admin@example.test",
    name: "Email Test Admin",
    type: "team-session",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  });
}

async function request(path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { port } = appServer.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function getRequest(path: string): Promise<{ status: number; body: unknown }> {
  const { port } = appServer.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    headers: { authorization: `Bearer ${adminToken()}` },
  });
  return { status: response.status, body: await response.json() };
}

describe("ProjectHub auth email delivery", () => {
  it("returns emailSent when Resend accepts an invitation", async () => {
    const email = "projecthub-invite-email-466@example.invalid";
    resendStatus = 200;
    resendHits = [];
    await pool.query("DELETE FROM team_invitations WHERE email = $1", [email]);

    const response = await request("/auth/invitations", { email });

    assert.equal(response.status, 201);
    assert.equal(response.body["emailSent"], true);
    assert.equal(response.body["email"], email);
    assert.equal(resendHits.length, 1);
    assert.equal(resendHits[0]?.["to"], email);

    await pool.query("DELETE FROM team_invitations WHERE email = $1", [email]);
  });

  it("returns emailSent false but preserves the admin reset URL when Resend rejects it", async () => {
    const userId = "projecthub-reset-email-466";
    const email = "projecthub-reset-email-466@example.invalid";
    resendStatus = 403;
    resendHits = [];
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM team_users WHERE id = $1", [userId]);
    await pool.query(
      `INSERT INTO team_users (id, email, name, password_hash, role, is_active)
       VALUES ($1, $2, 'Reset Email Test', 'unused', 'member', true)`,
      [userId, email],
    );

    try {
      const response = await request(`/auth/users/${userId}/reset-password`);

      assert.equal(response.status, 200);
      assert.equal(response.body["emailSent"], false);
      assert.equal(response.body["email"], email);
      assert.match(String(response.body["resetUrl"]), /\/reset-password\?token=/);
      assert.equal(resendHits.length, 1);
      assert.equal(resendHits[0]?.["to"], email);
    } finally {
      await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM team_users WHERE id = $1", [userId]);
    }
  });

  it("retains a Resend message ID and safely exposes delayed and bounced recovery delivery events", async () => {
    const email = "projecthub-recovery-delivery-566@example.invalid";
    resendStatus = 200;
    resendLastEvent = "email.delivery_delayed";
    resendHits = [];
    await pool.query("DELETE FROM team_invitations WHERE email = $1", [email]);
    await pool.query("DELETE FROM uc_notification_log WHERE recipient = $1", [email]);

    try {
      const invite = await request("/auth/invitations", { email });
      assert.equal(invite.status, 201);

      const delayed = await getRequest("/auth/recovery-emails?limit=20");
      assert.equal(delayed.status, 200);
      const delayedRows = delayed.body as Array<Record<string, unknown>>;
      const row = delayedRows.find((item) => item["recipient"] === email);
      assert.ok(row, "the invitation should appear in recovery email delivery history");
      assert.equal(row["type"], "invitation");
      assert.equal(row["sendStatus"], "accepted");
      assert.equal(row["deliveryEvent"], "delayed");
      assert.equal("resendMessageId" in row, false);
      assert.equal("messageBody" in row, false);
      assert.equal("resetUrl" in row, false);

      const persisted = await pool.query(
        "SELECT resend_message_id, delivery_event, message_body FROM uc_notification_log WHERE recipient = $1",
        [email],
      );
      assert.equal(persisted.rows[0]?.["resend_message_id"], "resend-stub");
      assert.equal(persisted.rows[0]?.["delivery_event"], "delayed");
      assert.equal(persisted.rows[0]?.["message_body"], "");

      resendLastEvent = "email.bounced";
      const bounced = await getRequest("/auth/recovery-emails?limit=20");
      const bouncedRows = bounced.body as Array<Record<string, unknown>>;
      const bouncedRow = bouncedRows.find((item) => item["recipient"] === email);
      assert.equal(bouncedRow?.["deliveryEvent"], "bounced");
    } finally {
      await pool.query("DELETE FROM team_invitations WHERE email = $1", [email]);
      await pool.query("DELETE FROM uc_notification_log WHERE recipient = $1", [email]);
    }
  });
});