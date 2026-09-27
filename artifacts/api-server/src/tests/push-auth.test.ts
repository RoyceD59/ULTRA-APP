/**
 * Targeted security tests for the push-notification auth flow.
 *
 * Verifies:
 *   1. Valid tokens can register a push token and receive a notification.
 *   2. Forged tokens (unsigned / tampered payload) are rejected with 401.
 *   3. A valid token cannot overwrite another user's push token registration.
 *
 * Run with: pnpm --filter @workspace/api-server test
 * Uses Node.js built-in test runner (node:test) — no extra test deps needed.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";

// ── Minimal fetch wrapper that speaks to the running server ──────────────────
async function apiFetch(
  path: string,
  init: RequestInit & { server: http.Server }
): Promise<{ status: number; body: unknown }> {
  const { server, ...options } = init;
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, options);
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

// ── Start a test instance of the server ─────────────────────────────────────
// Import `app.ts` directly — `index.ts` auto-listens on PORT which we don't
// want inside tests; here we start the server on a random port ourselves.
let server: http.Server;
before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-push-auth-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});
after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));

// ── Helpers ──────────────────────────────────────────────────────────────────
function authHeader(claims: { id: number | string; email: string }) {
  return `Bearer ${issueToken({ ...claims, firstName: "Test", lastName: "User" })}`;
}

/** Craft a forged unsigned JWT for arbitrary claims — must be rejected. */
function forgedUnsignedToken(claims: object) {
  const h = Buffer.from('{"alg":"none"}').toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `Bearer ${h}.${p}.`;
}

/** Craft a tampered signed JWT (valid sig on different payload). */
function tamperedToken(realToken: string) {
  // Replace the payload with a different user while keeping the original sig
  const [header, , sig] = realToken.split(".");
  const fakePay = Buffer.from(JSON.stringify({ id: 9999, email: "evil@evil.com" })).toString("base64url");
  return `Bearer ${header}.${fakePay}.${sig}`;
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("Push notification auth", () => {
  const userA = { id: 1, email: "alice@example.com" };
  const userB = { id: 2, email: "bob@example.com" };

  it("allows a valid token to register a push token", async () => {
    const r = await apiFetch("/api/uc/notify/register", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader(userA) },
      body: JSON.stringify({ pushToken: "ExponentPushToken[AAAA]" }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  });

  it("rejects a request with no auth header (401)", async () => {
    const r = await apiFetch("/api/uc/notify/register", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pushToken: "ExponentPushToken[AAAA]" }),
    });
    assert.equal(r.status, 401);
  });

  it("rejects a forged unsigned token (401)", async () => {
    const r = await apiFetch("/api/uc/notify/register", {
      server,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: forgedUnsignedToken({ id: 99, email: "evil@evil.com" }),
      },
      body: JSON.stringify({ pushToken: "ExponentPushToken[EVIL]" }),
    });
    assert.equal(r.status, 401);
  });

  it("rejects a tampered payload (401)", async () => {
    const validToken = issueToken({ ...userA, firstName: "Alice", lastName: "Test" });
    const r = await apiFetch("/api/uc/notify/register", {
      server,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: tamperedToken(validToken),
      },
      body: JSON.stringify({ pushToken: "ExponentPushToken[TAMPERED]" }),
    });
    assert.equal(r.status, 401);
  });

  it("rejects /notify for unauthenticated request (401)", async () => {
    const r = await apiFetch("/api/uc/notify", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    assert.equal(r.status, 401);
  });

  it("rejects /notify for forged unsigned token targeting another user (401)", async () => {
    // alice is registered; attempt to send via a forged token claiming her id
    const r = await apiFetch("/api/uc/notify", {
      server,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: forgedUnsignedToken({ id: userA.id, email: userA.email }),
      },
      body: JSON.stringify({ title: "Forged notification" }),
    });
    assert.equal(r.status, 401);
  });

  it("returns 404 for authenticated user with no registered token", async () => {
    // userB has not registered a token yet
    const r = await apiFetch("/api/uc/notify", {
      server,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader(userB) },
      body: JSON.stringify({ title: "Test notification" }),
    });
    assert.equal(r.status, 404);
  });
});
