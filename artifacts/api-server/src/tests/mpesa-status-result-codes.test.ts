/**
 * Tests for the M-Pesa STK-push status route:
 *   GET /api/payments/mpesa/status/:checkoutRequestId
 *
 * Covers:
 *   (a) ResultCode "0"    → { status: "success" }
 *   (b) ResultCode "1"    → { status: "failed", retriable: false }   — insufficient funds
 *   (c) ResultCode "1032" → { status: "failed", retriable: false }   — user cancelled
 *   (d) ResultCode "2001" → { status: "failed", retriable: false }   — wrong PIN
 *   (e) ResultCode "1037" → { status: "failed", retriable: true }    — DS timeout (transient)
 *   (f) Unknown code "9999" → { status: "failed", retriable: true }  — unknown = transient by default
 *   (g) No ResultCode (Daraja still processing) → { status: "pending" }
 *
 * All tests import NON_RETRIABLE_CODES from the live payments route rather than
 * duplicating the set — this ensures the tests break if the set changes.
 *
 * Checkout alert-branching is covered by the uc-companion test:
 *   artifacts/uc-companion/hooks/__tests__/mpesaStatusClassifier.test.mts
 *
 * The Daraja token and query endpoints are stubbed via globalThis.fetch.
 * Fake env vars activate the real verification branch so the status handler
 * actually calls Daraja rather than returning the sandbox random mock.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { NON_RETRIABLE_CODES } from "../routes/payments.js";

// ── Real fetch reference — preserved before any stub can replace it ───────────
let realFetch: typeof globalThis.fetch;
let server: http.Server;

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function getStatus(
  checkoutRequestId: string,
  srv: http.Server = server,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = srv.address() as { port: number };
  const url = `http://localhost:${addr.port}/api/payments/mpesa/status/${encodeURIComponent(checkoutRequestId)}`;
  const res = await realFetch(url);
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* leave empty */
  }
  return { status: res.status, body };
}

/**
 * Stub globalThis.fetch for Daraja token + stkpushquery endpoints.
 *
 * @param queryResultCode  ResultCode string to return in the Daraja query body,
 *                         or undefined to omit ResultCode (simulates in-progress),
 *                         or null to throw a network error.
 * @param resultDesc       Optional ResultDesc string.
 * Returns a restore function.
 */
function stubDarajaStatus(
  queryResultCode: string | null | undefined,
  resultDesc = "Stub description",
): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url: unknown, _init?: RequestInit) => {
    const u = String(url);

    if (u.includes("/oauth/v1/generate")) {
      if (queryResultCode === null) throw new Error("ECONNREFUSED (stub token)");
      return new Response(JSON.stringify({ access_token: "stub_token_status" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (u.includes("/stkpushquery")) {
      if (queryResultCode === null) throw new Error("ECONNREFUSED (stub query)");
      // undefined → no ResultCode (still pending); Daraja returns an errorMessage instead
      if (queryResultCode === undefined) {
        return new Response(
          JSON.stringify({
            errorCode: "500.001.1001",
            errorMessage: "The transaction is being processed",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      const body: Record<string, string> = {
        ResultCode: queryResultCode,
        ResultDesc: resultDesc,
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Any other call (Resend, etc.) — accept silently
    return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
  };
  return () => {
    globalThis.fetch = orig;
  };
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

before(async () => {
  realFetch = globalThis.fetch;

  // Fake Daraja credentials activate the real verification branch
  // (without them the status route returns a random sandbox mock).
  process.env["MPESA_SHORTCODE"]       ??= "174379";
  process.env["MPESA_PASSKEY"]         ??= "test_passkey_status";
  process.env["MPESA_CONSUMER_KEY"]    ??= "test_key_status";
  process.env["MPESA_CONSUMER_SECRET"] ??= "test_secret_status";
  process.env["SESSION_SECRET"]        ??= "test-secret-mpesa-status";
  process.env["RESEND_BASE_URL"]       ??= "https://api.resend.com";
  process.env["RESEND_API_KEY"]        ??= "re_test_status_key";

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) =>
      err ? reject(err) : resolve(),
    );
  });
});

after(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    ),
);

// ── (a) ResultCode "0" → success ─────────────────────────────────────────────

describe('M-Pesa status route — ResultCode "0" (payment confirmed)', () => {
  it('returns { status: "success" } with no retriable field', async () => {
    const restore = stubDarajaStatus("0", "The service request is processed successfully.");
    try {
      const { status, body } = await getStatus("ws_CO_STATUS_0_test");
      assert.equal(status, 200);
      assert.equal(
        body["status"],
        "success",
        'ResultCode 0 must map to status "success"',
      );
      // retriable is only present for failed payments — must not be set here
      assert.ok(
        !("retriable" in body),
        "retriable must not be present for a successful payment",
      );
    } finally {
      restore();
    }
  });
});

// ── (b) ResultCode "1" → insufficient funds — non-retriable ──────────────────

describe('M-Pesa status route — ResultCode "1" (insufficient funds)', () => {
  it('returns { status: "failed", retriable: false } — code is in NON_RETRIABLE_CODES', async () => {
    // Verify via the live route AND the exported set so both layers agree.
    assert.ok(
      NON_RETRIABLE_CODES.has("1"),
      'ResultCode "1" must be in the exported NON_RETRIABLE_CODES set',
    );
    const restore = stubDarajaStatus(
      "1",
      "The balance is insufficient for the transaction",
    );
    try {
      const { status, body } = await getStatus("ws_CO_STATUS_1_test");
      assert.equal(status, 200);
      assert.equal(
        body["status"],
        "failed",
        'ResultCode 1 must map to status "failed"',
      );
      assert.strictEqual(
        body["retriable"],
        false,
        "insufficient funds is a definitive decline — retriable must be false",
      );
    } finally {
      restore();
    }
  });
});

// ── (c) ResultCode "1032" → user cancelled — non-retriable ───────────────────

describe('M-Pesa status route — ResultCode "1032" (user cancelled)', () => {
  it('returns { status: "failed", retriable: false } — code is in NON_RETRIABLE_CODES', async () => {
    assert.ok(
      NON_RETRIABLE_CODES.has("1032"),
      'ResultCode "1032" must be in the exported NON_RETRIABLE_CODES set',
    );
    const restore = stubDarajaStatus(
      "1032",
      "Request cancelled by user",
    );
    try {
      const { status, body } = await getStatus("ws_CO_STATUS_1032_test");
      assert.equal(status, 200);
      assert.equal(
        body["status"],
        "failed",
        'ResultCode 1032 must map to status "failed"',
      );
      assert.strictEqual(
        body["retriable"],
        false,
        "user cancelled is a deliberate action — retriable must be false so we don't offer a confusing 'Try again'",
      );
    } finally {
      restore();
    }
  });
});

// ── (d) ResultCode "2001" → wrong PIN — non-retriable ────────────────────────

describe('M-Pesa status route — ResultCode "2001" (wrong PIN)', () => {
  it('returns { status: "failed", retriable: false } — code is in NON_RETRIABLE_CODES', async () => {
    assert.ok(
      NON_RETRIABLE_CODES.has("2001"),
      'ResultCode "2001" must be in the exported NON_RETRIABLE_CODES set',
    );
    const restore = stubDarajaStatus(
      "2001",
      "The initiator information is invalid.",
    );
    try {
      const { status, body } = await getStatus("ws_CO_STATUS_2001_test");
      assert.equal(status, 200);
      assert.equal(
        body["status"],
        "failed",
        'ResultCode 2001 must map to status "failed"',
      );
      assert.strictEqual(
        body["retriable"],
        false,
        "wrong PIN is a definitive user error — retriable must be false (hint: use Safaricom app to verify PIN)",
      );
    } finally {
      restore();
    }
  });
});

// ── (e) ResultCode "1037" → DS timeout (transient) — retriable ───────────────

describe('M-Pesa status route — ResultCode "1037" (DS timeout, transient)', () => {
  it('returns { status: "failed", retriable: true } — code is NOT in NON_RETRIABLE_CODES', async () => {
    assert.ok(
      !NON_RETRIABLE_CODES.has("1037"),
      'ResultCode "1037" must NOT be in NON_RETRIABLE_CODES — it is a transient network timeout',
    );
    const restore = stubDarajaStatus(
      "1037",
      "DS timeout user cannot be reached",
    );
    try {
      const { status, body } = await getStatus("ws_CO_STATUS_1037_test");
      assert.equal(status, 200);
      assert.equal(
        body["status"],
        "failed",
        'ResultCode 1037 must map to status "failed"',
      );
      assert.strictEqual(
        body["retriable"],
        true,
        "1037 is a network/handset timeout — retriable must be true so the client offers 'Try again / COD'",
      );
    } finally {
      restore();
    }
  });
});

// ── (f) Unknown ResultCode → treated as transient/retriable ──────────────────

describe("M-Pesa status route — unknown ResultCode (treated as transient)", () => {
  it('returns { status: "failed", retriable: true } for an unrecognised ResultCode', async () => {
    assert.ok(
      !NON_RETRIABLE_CODES.has("9999"),
      "unknown codes must not be in NON_RETRIABLE_CODES — they default to retriable=true",
    );
    const restore = stubDarajaStatus("9999", "Unknown error");
    try {
      const { status, body } = await getStatus("ws_CO_STATUS_9999_test");
      assert.equal(status, 200);
      assert.equal(
        body["status"],
        "failed",
        "unknown ResultCode must still map to failed",
      );
      assert.strictEqual(
        body["retriable"],
        true,
        "unknown codes default to retriable=true to avoid a silent dead end",
      );
    } finally {
      restore();
    }
  });
});

// ── (g) No ResultCode (in-progress) → pending ────────────────────────────────

describe("M-Pesa status route — no ResultCode (transaction still processing)", () => {
  it('returns { status: "pending" } when Daraja has not yet completed the transaction', async () => {
    // undefined → stub returns errorMessage only, no ResultCode
    const restore = stubDarajaStatus(undefined);
    try {
      const { status, body } = await getStatus("ws_CO_STATUS_PENDING_test");
      assert.equal(status, 200);
      assert.equal(
        body["status"],
        "pending",
        'absent ResultCode must map to status "pending" — client should keep polling',
      );
      assert.ok(
        !("retriable" in body),
        "retriable must not be present on a pending response",
      );
    } finally {
      restore();
    }
  });
});
