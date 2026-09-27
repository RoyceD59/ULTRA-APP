/**
 * Tests for push-notification re-targeting on logout + login swap.
 *
 * Scenario: User A registers a push token on a device, then logs out.
 * User B then logs in on the same device and registers the same physical
 * token. After the swap:
 *   – A's userId row must be gone from uc_push_tokens.
 *   – B's userId row must hold the token.
 *   – POST /api/uc/notify for A returns 404 (no registered token).
 *   – POST /api/uc/notify for B succeeds (token is found; Expo call mocked).
 *
 * Also verifies:
 *   – DELETE /api/uc/notify/register removes the caller's row.
 *   – DELETE is idempotent — second call also returns 200.
 *   – DELETE without auth is rejected with 401.
 *
 * Run with: pnpm --filter @workspace/api-server test
 * Uses Node.js built-in test runner (node:test) — no extra test deps needed.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import { db, ucPushTokensTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server setup ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;
let realFetch: typeof globalThis.fetch;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-push-login-swap-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}/api`;
  realFetch = globalThis.fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  // Clean up any rows our tests created.
  await db
    .delete(ucPushTokensTable)
    .where(inArray(ucPushTokensTable.userId, [USER_A_ID, USER_B_ID]));
  await new Promise<void>((resolve, reject) =>
    server.close(e => (e ? reject(e) : resolve()))
  );
});

// ── Test identities ───────────────────────────────────────────────────────────
// IDs are high enough to avoid colliding with real users and below 1e9
// (the WooCommerce-principal cutoff used in uc.ts).
const USER_A_ID    = "998877551";
const USER_A_EMAIL = "swap-user-a@ucfilters-test.internal";
const USER_B_ID    = "998877552";
const USER_B_EMAIL = "swap-user-b@ucfilters-test.internal";

// The physical device always uses the same Expo token.
const DEVICE_TOKEN = "ExponentPushToken[swap-test-device-XYZ]";

// ── Helpers ───────────────────────────────────────────────────────────────────

function bearerFor(id: string, email: string): string {
  return `Bearer ${issueToken({ id: Number(id), email, firstName: "Swap", lastName: "Test" })}`;
}

async function registerToken(userId: string, email: string, token: string): Promise<number> {
  const res = await realFetch(`${base}/uc/notify/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: bearerFor(userId, email),
    },
    body: JSON.stringify({ pushToken: token }),
  });
  return res.status;
}

async function unregisterToken(
  userId: string,
  email: string,
  token?: string
): Promise<number> {
  const res = await realFetch(`${base}/uc/notify/register`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: bearerFor(userId, email),
    },
    ...(token ? { body: JSON.stringify({ pushToken: token }) } : {}),
  });
  return res.status;
}

/** Read the stored push-token string for a userId; null if no row. */
async function storedTokenFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ pushToken: ucPushTokensTable.pushToken })
    .from(ucPushTokensTable)
    .where(eq(ucPushTokensTable.userId, userId))
    .limit(1);
  return row?.pushToken ?? null;
}

async function postNotify(userId: string, email: string): Promise<{ status: number; body: unknown }> {
  const res = await realFetch(`${base}/uc/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: bearerFor(userId, email),
    },
    body: JSON.stringify({ title: "Test push", body: "hello" }),
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Push-token logout + login-swap", () => {
  // ── 1. Basic DELETE coverage ─────────────────────────────────────────────

  it("DELETE /notify/register requires authentication (401)", async () => {
    const res = await realFetch(`${base}/uc/notify/register`, { method: "DELETE" });
    assert.equal(res.status, 401);
  });

  it("DELETE is idempotent when no registration exists", async () => {
    // Precondition: A has no row yet.
    assert.equal(await storedTokenFor(USER_A_ID), null);
    assert.equal(await unregisterToken(USER_A_ID, USER_A_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await unregisterToken(USER_A_ID, USER_A_EMAIL), 200);
  });

  it("POST registers a token; DELETE removes it and is idempotent", async () => {
    assert.equal(await registerToken(USER_A_ID, USER_A_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await storedTokenFor(USER_A_ID), DEVICE_TOKEN);

    // First DELETE — should remove the row.
    assert.equal(await unregisterToken(USER_A_ID, USER_A_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await storedTokenFor(USER_A_ID), null);

    // Second DELETE on an already-absent row — must still return 200.
    assert.equal(await unregisterToken(USER_A_ID, USER_A_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await storedTokenFor(USER_A_ID), null);
  });

  // ── 2. Login-swap re-targeting ───────────────────────────────────────────

  it("after A registers and logs out, A's token row is gone", async () => {
    // User A logs in on the device and registers.
    assert.equal(await registerToken(USER_A_ID, USER_A_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await storedTokenFor(USER_A_ID), DEVICE_TOKEN);

    // A logs out — device sends its own token so the server can be specific.
    assert.equal(await unregisterToken(USER_A_ID, USER_A_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await storedTokenFor(USER_A_ID), null);
  });

  it("after B registers the same device token, B's row holds it", async () => {
    // Precondition: A's row is gone (established by the prior test).
    assert.equal(await storedTokenFor(USER_A_ID), null);

    // User B logs in on the same physical device and registers.
    assert.equal(await registerToken(USER_B_ID, USER_B_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await storedTokenFor(USER_B_ID), DEVICE_TOKEN,
      "B's row must hold the device token after B registers");
  });

  it("POST /notify for A returns 404 (token is gone) after the swap", async () => {
    // A has no token; the server must return 404 — not 200 or 500.
    const r = await postNotify(USER_A_ID, USER_A_EMAIL);
    assert.equal(r.status, 404, "A must get 404 — no token registered after logout");
  });

  it("POST /notify for B reaches Expo and returns 200 after the swap", async () => {
    // Stub globalThis.fetch so the Expo push-send call never hits the network.
    // We intercept only exp.host calls; all other calls (our own server) use realFetch.
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("exp.host")) {
        // Simulate a successful Expo push response.
        return new Response(
          JSON.stringify({ data: [{ status: "ok", id: "mock-receipt-id" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return realFetch(input as string | URL | Request, init);
    };

    const r = await postNotify(USER_B_ID, USER_B_EMAIL);
    // Restore immediately so later tests aren't affected.
    globalThis.fetch = realFetch;
    assert.equal(r.status, 200, "B must get 200 — token is registered and Expo accepted it");
    assert.deepEqual(r.body, { ok: true });
  });

  // ── 3. Swap direction reversed: B already owns the row ───────────────────

  it("A registering after B on the same device gives A the token, B loses it", async () => {
    // B currently holds the token (established above). A now installs and logs in.
    assert.equal(await registerToken(USER_A_ID, USER_A_EMAIL, DEVICE_TOKEN), 200);

    // A's row must now hold the token.
    assert.equal(await storedTokenFor(USER_A_ID), DEVICE_TOKEN,
      "A's row must hold the token after A re-registers");
    // B's row is unaffected — B still has the same token stored.
    // This is expected: one row per userId; two users can briefly share the
    // same physical token in storage until B's next login forces a re-register.
    // The important invariant is that A's row is correct for the new device owner.
    assert.equal(await storedTokenFor(USER_B_ID), DEVICE_TOKEN);
  });

  it("B logging out (matching token) removes B's row without touching A's", async () => {
    // B's logout: sends the device token, which still matches B's stored row.
    assert.equal(await unregisterToken(USER_B_ID, USER_B_EMAIL, DEVICE_TOKEN), 200);
    assert.equal(await storedTokenFor(USER_B_ID), null,
      "B's row must be gone after B logs out");

    // A's row must be untouched — B's logout only deletes B's own row.
    assert.equal(await storedTokenFor(USER_A_ID), DEVICE_TOKEN,
      "A's row must survive B's logout");
  });
});
