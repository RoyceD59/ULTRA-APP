/**
 * Tests for DELETE /api/uc/notify/register — device-specific unregistration.
 *
 * Push-token storage is one row per user, so "two devices" means the row
 * currently holds the token of the most recently registered device. Logout on
 * an older device (whose local token no longer matches the stored row) must
 * NOT delete the newer device's registration.
 *
 * Covers:
 *   1. Unregister with a mismatched token (old device) leaves the row intact.
 *   2. Unregister with the matching token removes the row.
 *   3. Unregister with no body (legacy client) removes the row.
 *   4. Unregister is idempotent when no row exists.
 *   5. Unregister without auth is rejected (401).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import { db, ucPushTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-push-unregister-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  await db.delete(ucPushTokensTable).where(eq(ucPushTokensTable.userId, TEST_USER_ID));
  await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
});

// Numeric id kept below 1e9 (WooCommerce-principal cutoff) and far above real ids.
const TEST_USER_ID = "998877661";
const TEST_EMAIL   = "push-unregister-test@ucfilters-test.internal";

const DEVICE_A_TOKEN = "ExponentPushToken[unregtest-device-A]";
const DEVICE_B_TOKEN = "ExponentPushToken[unregtest-device-B]";

function authHeader() {
  return `Bearer ${issueToken({ id: Number(TEST_USER_ID), email: TEST_EMAIL, firstName: "Push", lastName: "Test" })}`;
}

async function apiFetch(method: string, body?: object) {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}/api/uc/notify/register`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
}

async function storedToken(): Promise<string | null> {
  const [row] = await db
    .select({ pushToken: ucPushTokensTable.pushToken })
    .from(ucPushTokensTable)
    .where(eq(ucPushTokensTable.userId, TEST_USER_ID))
    .limit(1);
  return row?.pushToken ?? null;
}

describe("DELETE /api/uc/notify/register — device-specific unregister", () => {
  it("rejects unauthenticated unregister (401)", async () => {
    const addr = server.address() as { port: number };
    const res = await fetch(`http://localhost:${addr.port}/api/uc/notify/register`, {
      method: "DELETE",
    });
    assert.equal(res.status, 401);
  });

  it("logout on an old device does not remove the newer device's token", async () => {
    // Device A registers, then device B registers (overwrites the row — this
    // is the "user logged into a second device" state).
    assert.equal(await apiFetch("POST", { pushToken: DEVICE_A_TOKEN }), 200);
    assert.equal(await apiFetch("POST", { pushToken: DEVICE_B_TOKEN }), 200);
    assert.equal(await storedToken(), DEVICE_B_TOKEN);

    // Device A logs out, sending its own (now stale) token.
    assert.equal(await apiFetch("DELETE", { pushToken: DEVICE_A_TOKEN }), 200);

    // Device B must still be registered.
    assert.equal(await storedToken(), DEVICE_B_TOKEN,
      "unregister from an old device must not delete the current device's token");
  });

  it("logout on the current device removes its token", async () => {
    assert.equal(await storedToken(), DEVICE_B_TOKEN);
    assert.equal(await apiFetch("DELETE", { pushToken: DEVICE_B_TOKEN }), 200);
    assert.equal(await storedToken(), null);
  });

  it("is idempotent when no registration exists", async () => {
    assert.equal(await apiFetch("DELETE", { pushToken: DEVICE_B_TOKEN }), 200);
    assert.equal(await apiFetch("DELETE"), 200);
  });

  it("legacy unregister with no body still removes the user's row", async () => {
    assert.equal(await apiFetch("POST", { pushToken: DEVICE_A_TOKEN }), 200);
    assert.equal(await storedToken(), DEVICE_A_TOKEN);
    assert.equal(await apiFetch("DELETE"), 200);
    assert.equal(await storedToken(), null);
  });
});
