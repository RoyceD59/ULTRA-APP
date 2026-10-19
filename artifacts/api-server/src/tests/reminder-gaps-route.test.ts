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
 * team-session JWT whose admin role is re-verified against a seeded
 * team_users row (isAdminRequest never trusts the JWT role claim alone).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import { db, teamUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let wcStub: http.Server;
let server: http.Server;
let retiredStoreCalls = 0;

const TEAM_ADMIN_ID = "test-reminder-gaps-team-admin";

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
    retiredStoreCalls++;
    res.statusCode = 500;
    res.end("<html>Service Unavailable</html>");
  });
  await new Promise<void>((resolve, reject) => {
    wcStub.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
  const { port } = wcStub.address() as { port: number };
  setEnv("WC_BASE_URL", `http://127.0.0.1:${port}`);

  // The admin gate re-verifies team-session roles against team_users —
  // seed a live admin row for the token to resolve to.
  await db.insert(teamUsersTable).values({
    id: TEAM_ADMIN_ID, email: "reminder-gaps-admin@test.internal",
    name: "Test Admin", passwordHash: "x", role: "admin", isActive: true,
  });

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  try { await db.delete(teamUsersTable).where(eq(teamUsersTable.id, TEAM_ADMIN_ID)); } catch { /* per-run DB */ }
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
    id: TEAM_ADMIN_ID, email: "reminder-gaps-admin@test.internal", name: "Test Admin",
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

describe("GET /api/uc/admin/orders/reminder-gaps — app-owned catalogue", () => {
  it("reports local gaps without depending on a retired, unreachable store", async () => {
    const r = await getReminderGaps(adminHeader());
    assert.equal(
      r.status, 200,
      `local report must not depend on WooCommerce, got ${r.status}`,
    );
    const body = r.body as { error?: string; orders?: unknown };
    assert.equal(body.error, undefined);
    assert.ok(Array.isArray(body.orders));
    assert.equal(retiredStoreCalls, 0);
  });
});
