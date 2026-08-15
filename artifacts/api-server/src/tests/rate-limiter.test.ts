/**
 * Rate-limiter integration tests.
 *
 * Confirms:
 *   1. POST /auth/login blocks with HTTP 429 on the 11th request within a window
 *      (authLimiter: max 10).
 *   2. POST /payments/mpesa blocks with HTTP 429 on the 6th request within a window
 *      (paymentLimiter: max 5).
 *   3. The 429 response body contains the user-facing `error` string defined in
 *      rate-limiters.ts, so the client always receives a human-readable message.
 *
 * Isolation strategy:
 *   – express "trust proxy" is enabled on the imported app instance so
 *     X-Forwarded-For is honoured.
 *   – Each test uses a unique fake IP (X-Forwarded-For) so one test's window
 *     cannot bleed into another even when they run in the same process.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import app from "../app.js";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;
let ipCounter = 0;

/** Return a fresh fake IPv4 address for this test so windows never overlap. */
function uniqueIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
}

/** POST to a path with the given fake IP and JSON body. */
async function post(
  path: string,
  body: unknown,
  ip: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    /* ignore parse errors */
  }
  return { status: res.status, body: parsed };
}

before(
  async () => {
    // Trust X-Forwarded-For only from the loopback interface (127.0.0.1).
    // Using "loopback" instead of `true` avoids the permissive-proxy
    // ValidationError that express-rate-limit emits for `trust proxy: true`.
    app.set("trust proxy", "loopback");

    process.env["SESSION_SECRET"] ??= "test-secret-rate-limiter";

    // Ensure M-Pesa credentials are absent so the handler enters sandbox/demo
    // mode and returns a mock response — no Safaricom API call is ever made.
    // We use an empty body `{}` so the 400 validator fires before any M-Pesa
    // logic runs, giving us a clean, side-effect-free rate-limiter signal.
    delete process.env["MPESA_CONSUMER_KEY"];
    delete process.env["MPESA_CONSUMER_SECRET"];
    delete process.env["MPESA_SHORTCODE"];
    delete process.env["MPESA_PASSKEY"];

    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("No address"));
          return;
        }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
      server.on("error", reject);
    });
  },
  { timeout: 30_000 },
);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fire `count` requests to `path` with the given body and IP.
 * Returns an array of { status, body } in order.
 */
async function fireRequests(
  path: string,
  body: unknown,
  ip: string,
  count: number,
): Promise<Array<{ status: number; body: Record<string, unknown> }>> {
  const results: Array<{ status: number; body: Record<string, unknown> }> = [];
  for (let i = 0; i < count; i++) {
    results.push(await post(path, body, ip));
  }
  return results;
}

// ── Suite: auth/login rate limit ──────────────────────────────────────────────

describe("Rate limiter — POST /auth/login (max 10 per minute)", () => {
  it("first 10 requests are not rate-limited (do not return 429)", async () => {
    const ip = uniqueIp();
    const results = await fireRequests(
      "/auth/login",
      { email: "nonexistent@example.com", password: "WrongPassword1!" },
      ip,
      10,
    );

    for (let i = 0; i < results.length; i++) {
      assert.notEqual(
        results[i]!.status,
        429,
        `request ${i + 1} of 10 must not be rate-limited; got ${results[i]!.status}`,
      );
    }
  });

  it("11th request within the window returns HTTP 429", async () => {
    const ip = uniqueIp();
    // Exhaust the 10-request allowance.
    await fireRequests(
      "/auth/login",
      { email: "nonexistent@example.com", password: "WrongPassword1!" },
      ip,
      10,
    );

    // The 11th must be blocked.
    const eleventh = await post(
      "/auth/login",
      { email: "nonexistent@example.com", password: "WrongPassword1!" },
      ip,
    );
    assert.equal(
      eleventh.status,
      429,
      `11th request must return 429; got ${eleventh.status}`,
    );
  });

  it("429 body contains a user-facing 'error' string", async () => {
    const ip = uniqueIp();
    await fireRequests(
      "/auth/login",
      { email: "attacker@example.com", password: "GuessMe123!" },
      ip,
      10,
    );

    const blocked = await post(
      "/auth/login",
      { email: "attacker@example.com", password: "GuessMe123!" },
      ip,
    );

    assert.equal(blocked.status, 429, "must be 429");
    assert.ok(
      typeof blocked.body["error"] === "string" && blocked.body["error"].length > 0,
      `429 body must have a non-empty 'error' string; got: ${JSON.stringify(blocked.body)}`,
    );
    assert.ok(
      (blocked.body["error"] as string).toLowerCase().includes("wait"),
      `error message should mention 'wait'; got: "${blocked.body["error"]}"`,
    );
  });

  it("a different IP is not blocked by another IP's window", async () => {
    const attackerIp = uniqueIp();
    const userIp = uniqueIp();

    // Exhaust the attacker's allowance.
    await fireRequests(
      "/auth/login",
      { email: "victim@example.com", password: "wrong" },
      attackerIp,
      10,
    );
    const attackerBlocked = await post(
      "/auth/login",
      { email: "victim@example.com", password: "wrong" },
      attackerIp,
    );
    assert.equal(attackerBlocked.status, 429, "attacker must be blocked");

    // A legitimate user from a different IP must still get through.
    const legitimateUser = await post(
      "/auth/login",
      { email: "legit@example.com", password: "wrong" },
      userIp,
    );
    assert.notEqual(
      legitimateUser.status,
      429,
      `a different IP must not be blocked by another IP's limit; got ${legitimateUser.status}`,
    );
  });
});

// ── Suite: auth/register rate limit ──────────────────────────────────────────

// Register requests use an empty body `{}` so the handler's own
// `!token || !name || !password` guard rejects them with HTTP 400 before any
// DB read/write occurs. The limiter fires before the body is inspected.

describe("Rate limiter — POST /auth/register (max 10 per minute)", () => {
  it("first 10 requests are not rate-limited (400 from validator, not 429)", async () => {
    const ip = uniqueIp();
    const results = await fireRequests("/auth/register", {}, ip, 10);

    for (let i = 0; i < results.length; i++) {
      assert.equal(
        results[i]!.status,
        400,
        `request ${i + 1} of 10 must be rejected by the validator (400), not the limiter; got ${results[i]!.status}`,
      );
    }
  });

  it("11th request within the window returns HTTP 429 with a user-facing error", async () => {
    const ip = uniqueIp();
    await fireRequests("/auth/register", {}, ip, 10);

    const eleventh = await post("/auth/register", {}, ip);
    assert.equal(
      eleventh.status,
      429,
      `11th request must return 429; got ${eleventh.status}`,
    );
    assert.ok(
      typeof eleventh.body["error"] === "string" && eleventh.body["error"].length > 0,
      `429 body must have a non-empty 'error' string; got: ${JSON.stringify(eleventh.body)}`,
    );
    assert.ok(
      (eleventh.body["error"] as string).toLowerCase().includes("wait"),
      `error message should mention 'wait'; got: "${eleventh.body["error"]}"`,
    );
  });
});

// ── Suite: auth/forgot-password rate limit ───────────────────────────────────

// Forgot-password requests use an empty body `{}` so the handler's own
// `!email` guard rejects them with HTTP 400 before any DB lookup, token
// creation, or notification delivery occurs.

describe("Rate limiter — POST /auth/forgot-password (max 10 per minute)", () => {
  it("first 10 requests are not rate-limited (400 from validator, not 429)", async () => {
    const ip = uniqueIp();
    const results = await fireRequests("/auth/forgot-password", {}, ip, 10);

    for (let i = 0; i < results.length; i++) {
      assert.equal(
        results[i]!.status,
        400,
        `request ${i + 1} of 10 must be rejected by the validator (400), not the limiter; got ${results[i]!.status}`,
      );
    }
  });

  it("11th request within the window returns HTTP 429 with a user-facing error", async () => {
    const ip = uniqueIp();
    await fireRequests("/auth/forgot-password", {}, ip, 10);

    const eleventh = await post("/auth/forgot-password", {}, ip);
    assert.equal(
      eleventh.status,
      429,
      `11th request must return 429; got ${eleventh.status}`,
    );
    assert.ok(
      typeof eleventh.body["error"] === "string" && eleventh.body["error"].length > 0,
      `429 body must have a non-empty 'error' string; got: ${JSON.stringify(eleventh.body)}`,
    );
    assert.ok(
      (eleventh.body["error"] as string).toLowerCase().includes("wait"),
      `error message should mention 'wait'; got: "${eleventh.body["error"]}"`,
    );
  });
});

// ── Suite: payments/mpesa rate limit ─────────────────────────────────────────

// ── M-Pesa safety note ────────────────────────────────────────────────────────
// All M-Pesa requests use an empty body `{}` so they are rejected by the
// handler's own `!phone || !amount` guard with HTTP 400 before any Safaricom
// API call, DB write, or STK push occurs.  The before() hook also deletes the
// Daraja credentials so even a request with a valid body cannot reach the live
// API.  The rate limiter fires before the body is inspected, so a 429 on the
// 6th request is still a valid signal that the limiter is working correctly.
// ─────────────────────────────────────────────────────────────────────────────

describe("Rate limiter — POST /payments/mpesa (max 5 per minute)", () => {
  it("first 5 requests are not rate-limited — each returns 400, not 429", async () => {
    const ip = uniqueIp();
    // Empty body → 400 from the handler validator (phone/amount required).
    const results = await fireRequests("/payments/mpesa", {}, ip, 5);

    for (let i = 0; i < results.length; i++) {
      assert.equal(
        results[i]!.status,
        400,
        `request ${i + 1} of 5 must be rejected by the validator (400), not the limiter; got ${results[i]!.status}`,
      );
    }
  });

  it("6th request within the window returns HTTP 429", async () => {
    const ip = uniqueIp();
    // Exhaust the 5-request allowance with harmless empty bodies.
    await fireRequests("/payments/mpesa", {}, ip, 5);

    const sixth = await post("/payments/mpesa", {}, ip);
    assert.equal(
      sixth.status,
      429,
      `6th request must be blocked by the rate limiter (429); got ${sixth.status}`,
    );
  });

  it("429 body contains a user-facing 'error' string", async () => {
    const ip = uniqueIp();
    await fireRequests("/payments/mpesa", {}, ip, 5);

    const blocked = await post("/payments/mpesa", {}, ip);

    assert.equal(blocked.status, 429, "must be 429");
    assert.ok(
      typeof blocked.body["error"] === "string" && blocked.body["error"].length > 0,
      `429 body must have a non-empty 'error' string; got: ${JSON.stringify(blocked.body)}`,
    );
    assert.ok(
      (blocked.body["error"] as string).toLowerCase().includes("payment"),
      `error message should mention 'payment'; got: "${blocked.body["error"]}"`,
    );
  });

  it("a different IP is not blocked by another IP's payment window", async () => {
    const attackerIp = uniqueIp();
    const userIp = uniqueIp();

    // Exhaust the attacker's allowance.
    await fireRequests("/payments/mpesa", {}, attackerIp, 5);
    const attackerBlocked = await post("/payments/mpesa", {}, attackerIp);
    assert.equal(attackerBlocked.status, 429, "attacker must be blocked");

    // A legitimate user from a different IP must still be served (400 from the
    // validator, NOT 429 from the limiter).
    const legitimateUser = await post("/payments/mpesa", {}, userIp);
    assert.notEqual(
      legitimateUser.status,
      429,
      `a different IP must not be blocked by the attacker's window; got ${legitimateUser.status}`,
    );
  });
});
