/**
 * Tests for push-token rotation — a rotated Expo token reaches the server
 * before the first push after login.
 *
 * Scenario: A user registers a push token, then the OS rotates the token
 * (reinstall, OS update, permission toggle). On the next login the client
 * calls POST /api/uc/notify/register with the new token. The test confirms:
 *   – The stored token is overwritten with the new value.
 *   – A subsequent POST /api/uc/notify sends to the NEW token, not the stale one.
 *   – Expo is never called with the stale token (which would have returned
 *     DeviceNotRegistered and silently dropped the notification).
 *
 * Run with: pnpm --filter @workspace/api-server test
 * Uses Node.js built-in test runner (node:test) — no extra test deps needed.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";
import { issueToken } from "../lib/jwt.js";
import { db, ucPushTokensTable, ucOrdersTable, ucOrderItemsTable, ucUsersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Test identity is initialized before node:test can invoke the setup hook.
// Below the WooCommerce-principal cutoff, and isolated by the test runner DB.
const USER_ID    = "998877601";
const USER_EMAIL = "rotation-test@ucfilters-test.internal";
const STALE_TOKEN = "ExponentPushToken[rotation-test-STALE]";
const FRESH_TOKEN = "ExponentPushToken[rotation-test-FRESH]";

// ── Server setup ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;
let realFetch: typeof globalThis.fetch;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-push-token-rotation-tests";
  // Keep order-confirmation coverage on the local DB path, with no live gateways.
  for (const key of [
    "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET",
    "MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY",
  ]) delete process.env[key];
  delete process.env["UC_CANONICAL_DUAL_WRITES"];
  // Force Resend through global fetch; the connector proxy bypasses that stub.
  process.env["RESEND_BASE_URL"] = "https://resend.test.invalid";
  delete process.env["RESEND_API_KEY"];
  await db.insert(ucUsersTable).values({
    id: Number(USER_ID), email: USER_EMAIL,
    passwordHash: await bcryptjs.hash("PushFixture123!", 4),
    firstName: "Rotation", lastName: "Test",
  });
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}/api`;
  realFetch = globalThis.fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  const orders = await db.select({ id: ucOrdersTable.id }).from(ucOrdersTable)
    .where(eq(ucOrdersTable.userId, USER_ID));
  if (orders.length) {
    await db.delete(ucOrderItemsTable)
      .where(inArray(ucOrderItemsTable.orderId, orders.map(order => order.id)));
    await db.delete(ucOrdersTable).where(eq(ucOrdersTable.userId, USER_ID));
  }
  await db
    .delete(ucPushTokensTable)
    .where(inArray(ucPushTokensTable.userId, [USER_ID]));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, Number(USER_ID)));
  await new Promise<void>((resolve, reject) =>
    server.close(e => (e ? reject(e) : resolve()))
  );
});

describe("Background order-confirmation push stale-token cleanup", () => {
  it("removes DeviceNotRegistered after the order response, and the next manual push sees no token", async () => {
    assert.equal(await registerToken(STALE_TOKEN), 200);
    assert.equal(await storedToken(), STALE_TOKEN);

    const expoMessages: Array<{ to: string; data: { screen: string; orderId: string } }> = [];
    let emailIntercepted = false;
    let releaseExpo!: () => void;
    const expoResponseGate = new Promise<void>(resolve => { releaseExpo = resolve; });
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://exp.host/--/api/v2/push/send") {
        expoMessages.push(...JSON.parse(String(init?.body)));
        // The order route must finish without waiting for the provider.
        await expoResponseGate;
        return new Response(JSON.stringify({
          data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "https://resend.test.invalid/emails") {
        emailIntercepted = true;
        return new Response(JSON.stringify({ id: "background-push-test-email" }), { status: 200 });
      }
      throw new Error(`Unexpected outbound request in background push test: ${url}`);
    };

    try {
      const orderResponse = await realFetch(`${base}/uc/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerFor(USER_ID, USER_EMAIL),
        },
        body: JSON.stringify({
          lineItems: [{ productId: 1, quantity: 1 }],
          paymentMethod: "cod",
          shippingAddress: {
            firstName: "Jane", lastName: "Buyer", address1: "1 Test Street",
            city: "Nairobi", country: "KE", phone: "+254712345678",
          },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      const order = await orderResponse.json() as { id: number };
      assert.equal(orderResponse.status, 200, JSON.stringify(order));
      assert.ok(Number.isInteger(order.id), "a real local order must have been created");
      assert.equal(await storedToken(), STALE_TOKEN,
        "provider response is still pending when the order response completes");

      releaseExpo();
      // sendPushToUser returns void: wait for its DB deletion, not a fixed sleep.
      const deadline = Date.now() + 5_000;
      while ((await storedToken() !== null || !emailIntercepted) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(await storedToken(), null,
        "background order push must remove the stale token row");
      assert.ok(emailIntercepted, "order email must be intercepted before restoring fetch");
      assert.equal(expoMessages.length, 1, "order confirmation must call Expo exactly once");
      assert.equal(expoMessages[0].to, STALE_TOKEN);
      assert.deepEqual(expoMessages[0].data, { screen: "orders", orderId: String(order.id) });

      const manualResponse = await realFetch(`${base}/uc/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerFor(USER_ID, USER_EMAIL),
        },
        body: JSON.stringify({ title: "After background cleanup", body: "hello" }),
      });
      assert.equal(manualResponse.status, 404);
      assert.deepEqual(await manualResponse.json(), {
        error: "No push token registered for this account",
      });
      assert.equal(expoMessages.length, 1, "manual push must not resend to the stale token");
    } finally {
      releaseExpo();
      globalThis.fetch = realFetch;
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function bearerFor(id: string, email: string): string {
  return `Bearer ${issueToken({ id: Number(id), email, firstName: "Rotation", lastName: "Test" })}`;
}

async function registerToken(token: string): Promise<number> {
  const res = await realFetch(`${base}/uc/notify/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: bearerFor(USER_ID, USER_EMAIL),
    },
    body: JSON.stringify({ pushToken: token }),
  });
  return res.status;
}

/** Read the stored push-token string for the test user; null if no row. */
async function storedToken(): Promise<string | null> {
  const [row] = await db
    .select({ pushToken: ucPushTokensTable.pushToken })
    .from(ucPushTokensTable)
    .where(eq(ucPushTokensTable.userId, USER_ID))
    .limit(1);
  return row?.pushToken ?? null;
}

/**
 * POST /api/uc/notify for the test user.
 * The Expo push API is stubbed so no real network call is made.
 * Returns { status, body, tokensCalledWithExpo } — the last array records
 * which push token(s) were passed to the stubbed Expo endpoint.
 */
async function postNotifyAndCapture(): Promise<{
  status: number;
  body: unknown;
  tokensCalledWithExpo: string[];
}> {
  const tokensCalledWithExpo: string[] = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;

    if (url.includes("exp.host")) {
      // Capture which token the server passed to Expo.
      try {
        const body = JSON.parse((init?.body as string) ?? "[]") as Array<{ to?: string }>;
        for (const msg of body) {
          if (msg.to) tokensCalledWithExpo.push(msg.to);
        }
      } catch { /* ignore parse errors */ }

      return new Response(
        JSON.stringify({ data: [{ status: "ok", id: "mock-receipt-id" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return realFetch(input as string | URL | Request, init);
  };

  try {
    const res = await realFetch(`${base}/uc/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerFor(USER_ID, USER_EMAIL),
      },
      body: JSON.stringify({ title: "Rotation test push", body: "hello" }),
    });
    let body: unknown;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body, tokensCalledWithExpo };
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Push-token rotation before first post-login push", () => {
  // ── 1. Initial (stale) token registration ────────────────────────────────

  it("registers the stale (pre-rotation) token initially", async () => {
    assert.equal(await registerToken(STALE_TOKEN), 200);
    assert.equal(await storedToken(), STALE_TOKEN,
      "stale token must be stored after first registration");
  });

  // ── 2. Token rotation: re-register with the fresh token ──────────────────

  it("re-registering with the rotated token overwrites the stale token", async () => {
    // Simulate the OS rotating the token (e.g. reinstall / OS update).
    // The client calls POST /notify/register with the new token on next login.
    assert.equal(await registerToken(FRESH_TOKEN), 200);

    const stored = await storedToken();
    assert.equal(stored, FRESH_TOKEN,
      "stored token must be updated to the fresh (rotated) token");
    assert.notEqual(stored, STALE_TOKEN,
      "stale token must no longer be in the DB after rotation");
  });

  // ── 3. First push after rotation goes to the fresh token ─────────────────

  it("the first POST /notify after rotation sends to the fresh token, not the stale one", async () => {
    const { status, body, tokensCalledWithExpo } = await postNotifyAndCapture();

    assert.equal(status, 200, "push must succeed after token rotation");
    assert.deepEqual(body, { ok: true });

    assert.equal(tokensCalledWithExpo.length, 1,
      "Expo must be called exactly once");
    assert.equal(tokensCalledWithExpo[0], FRESH_TOKEN,
      "Expo must receive the fresh (rotated) token, not the stale one");
    assert.ok(
      !tokensCalledWithExpo.includes(STALE_TOKEN),
      "Expo must never be called with the stale token — that would produce DeviceNotRegistered"
    );
  });

  // ── 4. Stale-token path: what DeviceNotRegistered would look like ─────────
  //
  // This test confirms the server correctly interprets a DeviceNotRegistered
  // Expo error as a stale token and removes the row — reproducing the silent
  // drop that would have occurred had the rotation not been detected in time.

  it("Expo returning DeviceNotRegistered for a token causes the server to remove it and return 410", async () => {
    // Plant the stale token back so we can verify the 410 + cleanup path.
    assert.equal(await registerToken(STALE_TOKEN), 200);
    assert.equal(await storedToken(), STALE_TOKEN);

    // Stub Expo to return DeviceNotRegistered for the stale token.
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : (input as Request).url;

      if (url.includes("exp.host")) {
        return new Response(
          JSON.stringify({
            data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return realFetch(input as string | URL | Request, init);
    };

    let status: number;
    try {
      const res = await realFetch(`${base}/uc/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerFor(USER_ID, USER_EMAIL),
        },
        body: JSON.stringify({ title: "Stale-token push", body: "should fail" }),
      });
      status = res.status;
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(status!, 410,
      "server must return 410 when Expo reports DeviceNotRegistered");
    // The server must have cleaned up the stale token row.
    assert.equal(await storedToken(), null,
      "stale token row must be removed after DeviceNotRegistered");
  });

  // ── 5. After cleanup, re-registering the fresh token restores delivery ────

  it("re-registering the fresh token after stale-token cleanup restores push delivery", async () => {
    // Token row was removed in the previous test. Simulate next login re-registration.
    assert.equal(await storedToken(), null, "precondition: no token row");

    assert.equal(await registerToken(FRESH_TOKEN), 200);
    assert.equal(await storedToken(), FRESH_TOKEN,
      "fresh token must be stored after re-registration");

    const { status, body, tokensCalledWithExpo } = await postNotifyAndCapture();
    assert.equal(status, 200, "push must succeed after re-registration");
    assert.deepEqual(body, { ok: true });
    assert.equal(tokensCalledWithExpo[0], FRESH_TOKEN,
      "Expo must receive the fresh token after re-registration");
  });
});
