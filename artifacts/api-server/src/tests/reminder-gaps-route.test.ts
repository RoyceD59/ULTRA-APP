/**
 * Route-level tests for GET /api/uc/admin/orders/reminder-gaps.
 *
 * The report must fail LOUDLY when the live store is unreachable — a false
 * all-clear ("orders": []) would hide real reminder gaps from the team.
 *
 * Verifies:
 *   1. Unauthenticated request → 403
 *   2. Non-admin token → 403
 *   3. Admin + WC credentials + unreachable store → 502 with an error body,
 *      never a 200 with an empty orders array.
 *
 * Strategy: point WC_BASE_URL at a local stub that fails every request, set
 * dummy WC credentials so hasWCCredentials() is true, and hit the real
 * Express app on an ephemeral port. Admin auth uses a ProjectHub
 * team-session JWT with role "admin" (accepted directly by isAdminRequest,
 * no DB row needed).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";

let wcStub: http.Server;
let server: http.Server;

const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string) {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

before(async () => {
  setEnv("SESSION_SECRET", process.env["SESSION_SECRET"] ?? "test-secret-reminder-gaps-route");
  // Credentials present → the route MUST use the live store, never the mock
  // catalogue fallback.
  setEnv("WC_CONSUMER_KEY", "ck_test_unreachable");
  setEnv("WC_CONSUMER_SECRET", "cs_test_unreachable");

  // Stub store that is "down": every request gets a 500 with a non-JSON body,
  // so wcFetchArray → null → fetchAllPublishedProducts → null.
  wcStub = http.createServer((_req, res) => {
    res.statusCode = 500;
    res.end("<html>Service Unavailable</html>");
  });
  await new Promise<void>((resolve, reject) => {
    wcStub.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
  const { port } = wcStub.address() as { port: number };
  setEnv("WC_BASE_URL", `http://127.0.0.1:${port}`);

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => wcStub.close((e) => (e ? reject(e) : resolve())));
});

async function getReminderGaps(authHeader?: string): Promise<{ status: number; body: unknown }> {
  const { port } = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${port}/api/uc/admin/orders/reminder-gaps`, {
    headers: authHeader ? { Authorization: authHeader } : {},
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
}

function adminHeader(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `Bearer ${issueToken({
    id: "team-1", email: "admin@test.internal", name: "Test Admin",
    type: "team-session", role: "admin", exp,
  })}`;
}

describe("GET /api/uc/admin/orders/reminder-gaps — admin gating", () => {
  it("rejects an unauthenticated request with 403", async () => {
    const r = await getReminderGaps();
    assert.equal(r.status, 403);
  });

  it("rejects a non-admin team token with 403", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = issueToken({
      id: "team-2", email: "member@test.internal", name: "Test Member",
      type: "team-session", role: "member", exp,
    });
    const r = await getReminderGaps(`Bearer ${token}`);
    assert.equal(r.status, 403);
  });

  it("rejects a customer token that has no DB user row with 403", async () => {
    const token = issueToken({ id: 999_999_999 - 1, email: "ghost@example.com" });
    const r = await getReminderGaps(`Bearer ${token}`);
    assert.equal(r.status, 403);
  });
});

describe("GET /api/uc/admin/orders/reminder-gaps — unreachable store", () => {
  it("returns 502 (never an empty all-clear) when the store can't be fetched", async () => {
    const r = await getReminderGaps(adminHeader());
    assert.equal(
      r.status, 502,
      `expected 502 when the WooCommerce catalogue is unreachable, got ${r.status}`,
    );
    const body = r.body as { error?: string; orders?: unknown };
    assert.ok(body?.error, "502 body must carry an error message");
    assert.equal(
      body.orders, undefined,
      "an unreachable store must never return an orders array (false all-clear)",
    );
  });
});
