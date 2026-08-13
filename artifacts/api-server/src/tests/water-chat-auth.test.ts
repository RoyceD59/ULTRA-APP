/**
 * Unit tests for the water-chat endpoint auth and rate-limit logic.
 *
 * Covers the three requirements from the task:
 *   1. No token → 401 (authenticatedUserId returns null)
 *   2. Valid token → passes auth (authenticatedUserId returns a positive integer)
 *   3. More than 20 requests in one minute → rate-limited (isRateLimited returns true)
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { issueToken } from "../lib/jwt.js";
import { authenticatedUserId, isRateLimited } from "../routes/uc-water-chat.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Issue a minimal valid token for a regular DB user. */
function validBearerHeader(userId: number, email = "user@example.com"): string {
  const token = issueToken({ id: userId, email });
  return `Bearer ${token}`;
}

// ─── authenticatedUserId ──────────────────────────────────────────────────────

describe("authenticatedUserId — auth check", () => {
  // Ensure SESSION_SECRET is set for the jwt helpers
  let savedSecret: string | undefined;
  before(() => {
    savedSecret = process.env["SESSION_SECRET"];
    process.env["SESSION_SECRET"] = "test-secret-for-water-chat";
  });
  after(() => {
    if (savedSecret !== undefined) {
      process.env["SESSION_SECRET"] = savedSecret;
    } else {
      delete process.env["SESSION_SECRET"];
    }
  });

  it("returns null when Authorization header is absent (→ 401)", () => {
    const result = authenticatedUserId(undefined);
    assert.equal(result, null, "Missing header must return null so the route responds 401");
  });

  it("returns null when Authorization header is empty string (→ 401)", () => {
    const result = authenticatedUserId("");
    assert.equal(result, null);
  });

  it("returns null when the token is a random garbage string (→ 401)", () => {
    const result = authenticatedUserId("Bearer not-a-real-jwt");
    assert.equal(result, null);
  });

  it("returns null when the header is missing the Bearer prefix (→ 401)", () => {
    // Raw token without "Bearer " prefix
    const token = issueToken({ id: 1, email: "x@example.com" });
    const result = authenticatedUserId(token);
    assert.equal(result, null);
  });

  it("returns null when user id is zero (→ 401)", () => {
    const header = validBearerHeader(0);
    const result = authenticatedUserId(header);
    assert.equal(result, null, "id=0 is not a valid DB user id");
  });

  it("returns null when user id is negative (→ 401)", () => {
    const token  = issueToken({ id: -5, email: "x@example.com" });
    const result = authenticatedUserId(`Bearer ${token}`);
    assert.equal(result, null);
  });

  it("returns the numeric user id for a correctly signed token (→ auth passes)", () => {
    const userId = 42;
    const header = validBearerHeader(userId);
    const result = authenticatedUserId(header);
    assert.equal(result, userId, "Valid token must return the numeric user id");
    assert.ok(typeof result === "number" && result > 0,
      "Returned id must be a positive integer so the route proceeds past the auth guard");
  });

  it("returns the numeric user id for a large valid id (→ auth passes)", () => {
    // Regular DB users can have high ids but still below 1e9
    const userId = 999_999_999;
    const header = validBearerHeader(userId, "power@example.com");
    const result = authenticatedUserId(header);
    assert.equal(result, userId);
  });

  it("returns null for an expired token (→ 401)", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const token   = issueToken({ id: 7, email: "x@example.com", exp: pastExp });
    const result  = authenticatedUserId(`Bearer ${token}`);
    assert.equal(result, null, "Expired token must be rejected");
  });
});

// ─── isRateLimited — sliding-window rate limiter ──────────────────────────────

describe("isRateLimited — rate limit enforcement", () => {
  // Each describe block uses a distinct userId range so the shared rateLimitMap
  // never has cross-test interference.
  const BASE_ID = 100_000; // safe range for rate-limit tests only

  it("allows the first request (not rate-limited)", () => {
    const userId = BASE_ID + 1;
    assert.equal(isRateLimited(userId), false);
  });

  it("allows up to 20 requests within the window", () => {
    const userId = BASE_ID + 2;
    for (let i = 0; i < 20; i++) {
      assert.equal(isRateLimited(userId), false,
        `Request ${i + 1} of 20 should be allowed`);
    }
  });

  it("blocks the 21st request within the same minute (→ 429)", () => {
    const userId = BASE_ID + 3;
    // Exhaust the 20-request allowance
    for (let i = 0; i < 20; i++) {
      isRateLimited(userId);
    }
    // The 21st call must be rate-limited
    const blocked = isRateLimited(userId);
    assert.equal(blocked, true,
      "The 21st request in the same sliding window must return true (→ 429)");
  });

  it("continues blocking on subsequent requests after limit is hit", () => {
    const userId = BASE_ID + 4;
    for (let i = 0; i < 20; i++) {
      isRateLimited(userId);
    }
    // Multiple requests after the limit are all blocked
    for (let extra = 0; extra < 5; extra++) {
      assert.equal(isRateLimited(userId), true,
        `Extra request ${extra + 1} after limit must still be blocked`);
    }
  });

  it("does not affect a different user's quota", () => {
    const userA = BASE_ID + 5;
    const userB = BASE_ID + 6;
    // Exhaust userA
    for (let i = 0; i < 20; i++) {
      isRateLimited(userA);
    }
    assert.equal(isRateLimited(userA), true,  "userA should be blocked");
    assert.equal(isRateLimited(userB), false,  "userB must not be affected");
  });

  it("allows requests again after the one-minute sliding window expires", () => {
    const userId = BASE_ID + 7;
    const realNow = Date.now;

    // Record the base time so we can advance it deterministically
    const baseTime = realNow();

    // Stub Date.now so all 20 burst requests land at t=0
    let stubbedNow = baseTime;
    Date.now = () => stubbedNow;

    try {
      // Exhaust the 20-request allowance inside the window
      for (let i = 0; i < 20; i++) {
        assert.equal(isRateLimited(userId), false,
          `Request ${i + 1} should be allowed inside the window`);
      }

      // 21st request must be blocked (still inside the same window)
      assert.equal(isRateLimited(userId), true,
        "The 21st request must be blocked while still within the window");

      // Advance time by 61 seconds — all earlier timestamps are now outside the window
      stubbedNow = baseTime + 61_000;

      // The very next request after the window rolls over must be allowed
      assert.equal(isRateLimited(userId), false,
        "Request must be allowed again once the 60-second window has fully expired");
    } finally {
      // Always restore the real Date.now
      Date.now = realNow;
    }
  });
});
