/**
 * End-to-end tests for the central /uc/* deleted-account guard.
 *
 * Account deletion sets deleted_at, but the customer JWT remains
 * cryptographically valid until expiry. The router-level guard
 * (lib/uc-deleted-guard.ts) must reject a post-deletion token on EVERY
 * /uc/* route — across all UC route files — with 401, so the client signs
 * the user out everywhere immediately.
 *
 * Also verifies:
 *   - an identical, non-deleted user still passes through normally
 *   - DELETE /uc/customer stays idempotent (200 alreadyDeleted, not 401)
 *   - team-session tokens are unaffected by the guard
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import { pool } from "@workspace/db";

async function apiFetch(
  server: http.Server,
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, options);
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

let server: http.Server;
let deletedUserId: number;
let activeUserId: number;
let deletedHeader: string;
let activeHeader: string;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-deleted-guard-tests";
  // This suite tests the account guard, not provider availability. Without this
  // worker-local isolation, public GET assertions call the real store whenever
  // workspace WooCommerce credentials happen to be configured.
  delete process.env["WC_CONSUMER_KEY"];
  delete process.env["WC_CONSUMER_SECRET"];
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });

  // Seed one deleted and one active user directly in the DB.
  const suffix = Date.now();
  const del = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone, deleted_at)
     VALUES ($1, 'x', '[deleted customer]', '', '', now()) RETURNING id`,
    [`deleted-guard-${suffix}@example.com`]
  );
  deletedUserId = del.rows[0]!.id;
  const act = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, 'x', 'Active', 'User', '') RETURNING id`,
    [`active-guard-${suffix}@example.com`]
  );
  activeUserId = act.rows[0]!.id;

  deletedHeader = `Bearer ${issueToken({ id: deletedUserId, email: `deleted-guard-${suffix}@example.com` })}`;
  activeHeader  = `Bearer ${issueToken({ id: activeUserId,  email: `active-guard-${suffix}@example.com` })}`;
});

after(async () => {
  await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [[deletedUserId, activeUserId]]);
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
});

// Representative authenticated routes across every UC route file.
const GUARDED_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "GET",   path: "/api/uc/customer/profile" },
  { method: "PATCH", path: "/api/uc/customer/profile", body: { firstName: "X" } },
  { method: "GET",   path: "/api/uc/orders" },
  { method: "POST",  path: "/api/uc/products/1/reviews", body: { rating: 5, body: "x" } },
  { method: "GET",   path: "/api/uc/tickets" },
  { method: "PUT",   path: "/api/uc/reminders/sync", body: { filters: [] } },
  { method: "POST",  path: "/api/uc/ai/water-chat", body: { message: "hi" } },
  { method: "GET",   path: "/api/uc/impact" },
  { method: "GET",   path: "/api/uc/offline-clients" },
  // Even public reads must reject the stale token so the client signs out.
  { method: "GET",   path: "/api/uc/products" },
  // Mounted app-level BEFORE the /api router — must still be guarded.
  { method: "GET",   path: "/api/uc/product-images/hydra-flux-premium-filter-bottle.jpg" },
];

describe("deleted-account guard — post-deletion token is rejected on every /uc route", () => {
  for (const r of GUARDED_ROUTES) {
    it(`${r.method} ${r.path} → 401 for a deleted account's token`, async () => {
      const { status, body } = await apiFetch(server, r.path, {
        method: r.method,
        headers: {
          authorization: deletedHeader,
          ...(r.body ? { "content-type": "application/json" } : {}),
        },
        ...(r.body ? { body: JSON.stringify(r.body) } : {}),
      });
      assert.equal(status, 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
      assert.match(String((body as { error?: string })?.error ?? ""), /deleted/i);
    });
  }

  it("DELETE /uc/customer stays idempotent for an already-deleted account (200, not 401)", async () => {
    const { status, body } = await apiFetch(server, "/api/uc/customer", {
      method: "DELETE",
      headers: { authorization: deletedHeader },
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal((body as { alreadyDeleted?: boolean }).alreadyDeleted, true);
  });

  it("an active account's token still passes (GET /uc/customer/profile → 200)", async () => {
    const { status, body } = await apiFetch(server, "/api/uc/customer/profile", {
      headers: { authorization: activeHeader },
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal((body as { id?: number }).id, activeUserId);
  });

  it("unauthenticated public reads are unaffected (GET /uc/products → 200)", async () => {
    const { status } = await apiFetch(server, "/api/uc/products");
    assert.equal(status, 200);
  });

  it("team-session tokens are not looked up in uc_users (guard passes them through)", async () => {
    const teamHeader = `Bearer ${issueToken({
      id: deletedUserId, // same numeric id as the deleted customer — must NOT match
      email: "team@example.com",
      type: "team-session",
      role: "admin",
    })}`;
    // Public route with a team token: guard must not 401 it.
    const { status } = await apiFetch(server, "/api/uc/products", {
      headers: { authorization: teamHeader },
    });
    assert.equal(status, 200);
  });
});
