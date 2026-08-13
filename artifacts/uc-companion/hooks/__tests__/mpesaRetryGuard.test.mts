/**
 * Unit tests for the M-Pesa double-charge guard.
 *
 * The guard runs inside `handleMpesa` in app/checkout.tsx: when the customer
 * taps "Try again" after a timeout, it queries the status of the prior STK
 * push BEFORE sending a new one.  `decideRetryGuard` captures that decision
 * tree so it can be verified without React Native, Alert, or network I/O.
 *
 * Covers:
 *   (a) prior status = "success"  → use_prior  (create order; no new push)
 *   (b) prior status = "pending"  → resume_poll (keep polling; no new push)
 *   (c) prior status = "failed"   → fresh_push  (definitive; safe to retry)
 *   (d) network error on status query → resume_poll (safe default; no new push)
 *   (e) unexpected / unknown status  → resume_poll (safe default; no new push)
 *   (f) priorRef is threaded through to use_prior and resume_poll actions
 *
 * These tests directly exercise the branching that prevents double-charging:
 * any change to the decision tree in mpesaRetryGuard.ts will immediately
 * break the relevant case here.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideRetryGuard } from "../mpesaRetryGuard.js";

const PRIOR_REF = "ws_CO_RETRY_TEST_001";

// ── (a) success → use_prior (no second push) ──────────────────────────────────
//
// Scenario: customer's app crashed after payment completed but before the
// order was created.  When they tap "Try again", the status query returns
// "success".  The guard must use the original push (no new charge) and
// create the order from it.

describe("decideRetryGuard — prior status 'success'", () => {
  it('returns use_prior so the order is created from the original push — no second STK push', () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "success" },
    });
    assert.equal(
      action.kind,
      "use_prior",
      "success must produce use_prior — the original push already completed; a new push would double-charge",
    );
  });

  it("threads the priorRef through to use_prior so the caller knows which push to settle", () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "success" },
    });
    if (action.kind !== "use_prior") assert.fail(`Expected use_prior, got ${action.kind}`);
    assert.equal(
      action.priorRef,
      PRIOR_REF,
      "use_prior must carry the original CheckoutRequestID so createOrder uses it",
    );
  });

  it("returns use_prior regardless of resultDesc content", () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: {
        status: "success",
        resultDesc: "The service request is processed successfully.",
      },
    });
    assert.equal(action.kind, "use_prior");
  });
});

// ── (b) pending → resume_poll (no second push) ───────────────────────────────
//
// Scenario: the original STK push is still being processed by the customer
// (prompt still visible on their phone).  If a second push is sent now, both
// could complete — double charge.  The safe action is to resume polling the
// original push.

describe("decideRetryGuard — prior status 'pending'", () => {
  it('returns resume_poll so the original push keeps being polled — no second STK push', () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "pending" },
    });
    assert.equal(
      action.kind,
      "resume_poll",
      "pending means the original push is still live; resuming its poll is the only safe option",
    );
  });

  it("threads the priorRef through to resume_poll so the polling loop targets the right push", () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "pending" },
    });
    if (action.kind !== "resume_poll") assert.fail(`Expected resume_poll, got ${action.kind}`);
    assert.equal(
      action.priorRef,
      PRIOR_REF,
      "resume_poll must carry the original CheckoutRequestID so startMpesaPoll targets it",
    );
  });

  it("returns resume_poll for pending even when resultDesc is present", () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "pending", resultDesc: "Processing" },
    });
    assert.equal(action.kind, "resume_poll");
  });
});

// ── (b2) pending → eventually success: no second push ─────────────────────────
//
// Scenario: first poll returns pending, second poll returns success.
// The guard is only called on the very first check (before sending a new push).
// If that call returns pending, the guard routes to resume_poll — the polling
// loop takes over from there.  When the polling loop later sees success it
// calls classifyMpesaStatus({ status: "success" }) → create_order.
//
// This test verifies the guard correctly hands off to polling on "pending"
// and would NOT send a new push, so the eventual "success" is handled by
// the existing poll — no double charge.

describe("decideRetryGuard — pending then success: guard hands off to poll (no second push)", () => {
  it("pending guard action routes to resume_poll (not fresh_push), so polling handles the eventual success", () => {
    // Step 1: guard sees pending → must NOT send a fresh push
    const guardAction = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "pending" },
    });
    assert.equal(
      guardAction.kind,
      "resume_poll",
      "pending guard must produce resume_poll — the eventual success will be caught by the polling loop",
    );
    assert.notEqual(
      guardAction.kind,
      "fresh_push",
      "fresh_push here would risk a double charge if the original push completes moments later",
    );

    // Step 2: the polling loop then receives success.
    // classifyMpesaStatus handles this; the guard is no longer involved.
    // We verify the guard did its job: it returned resume_poll (above),
    // meaning the polling loop (not a new push) will handle the success.
    // No second STK push was initiated.
    if (guardAction.kind !== "resume_poll") assert.fail("guard must be resume_poll");
    assert.equal(
      guardAction.priorRef,
      PRIOR_REF,
      "the priorRef is passed to startMpesaPoll so it continues polling the same push",
    );
  });
});

// ── (c) failed → fresh_push (definitive; safe to retry) ──────────────────────
//
// Scenario: the original push definitively failed (wrong PIN, insufficient
// funds, user cancelled).  A new push is safe.

describe("decideRetryGuard — prior status 'failed'", () => {
  it("returns fresh_push so a new STK push may be issued", () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "failed", retriable: false },
    });
    assert.equal(
      action.kind,
      "fresh_push",
      "failed prior push is definitively done; a new push will not double-charge",
    );
  });

  it("returns fresh_push for retriable=true failed responses too (transient DS timeout)", () => {
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "failed", retriable: true },
    });
    assert.equal(
      action.kind,
      "fresh_push",
      "a retriable failed push is still done; a fresh push is the correct next step",
    );
  });
});

// ── (d) network error → resume_poll (safe default; no second push) ────────────
//
// Scenario: the status query itself fails (offline, DNS failure, server error).
// We cannot confirm the original push is dead.  The safest response is to
// resume polling it — never risk a double charge over a transient error.

describe("decideRetryGuard — network error on status query", () => {
  it("returns resume_poll when the status query fails — never assume the prior push is dead", () => {
    const action = decideRetryGuard(PRIOR_REF, { ok: false });
    assert.equal(
      action.kind,
      "resume_poll",
      "a failed status query must not trigger a new push — resume polling the original push",
    );
  });

  it("threads priorRef through to resume_poll on network error", () => {
    const action = decideRetryGuard(PRIOR_REF, { ok: false });
    if (action.kind !== "resume_poll") assert.fail(`Expected resume_poll, got ${action.kind}`);
    assert.equal(
      action.priorRef,
      PRIOR_REF,
      "priorRef must survive a network error so polling resumes on the right push",
    );
  });
});

// ── (e) unknown / unexpected status → resume_poll (safe default) ──────────────
//
// Scenario: the server returns a status string the client doesn't recognise.
// The safe default is resume_poll — we never assume it's safe to send a new
// push unless we have a definitive "failed" response.

describe("decideRetryGuard — unexpected status value (safe default)", () => {
  it("returns resume_poll for any status other than 'success' or 'failed'", () => {
    // Cast to bypass TypeScript's union — simulates an unknown future status.
    const action = decideRetryGuard(PRIOR_REF, {
      ok: true,
      response: { status: "unknown" as "pending" },
    });
    assert.equal(
      action.kind,
      "resume_poll",
      "unexpected status must default to resume_poll — never risk a double charge",
    );
  });
});

// ── (f) priorRef identity ─────────────────────────────────────────────────────

describe("decideRetryGuard — priorRef is always the one passed in", () => {
  it("use_prior carries the exact priorRef string", () => {
    const ref = "ws_CO_EXACT_REF_TEST";
    const action = decideRetryGuard(ref, { ok: true, response: { status: "success" } });
    if (action.kind !== "use_prior") assert.fail("expected use_prior");
    assert.equal(action.priorRef, ref);
  });

  it("resume_poll carries the exact priorRef string on pending", () => {
    const ref = "ws_CO_EXACT_REF_TEST";
    const action = decideRetryGuard(ref, { ok: true, response: { status: "pending" } });
    if (action.kind !== "resume_poll") assert.fail("expected resume_poll");
    assert.equal(action.priorRef, ref);
  });

  it("resume_poll carries the exact priorRef string on network error", () => {
    const ref = "ws_CO_EXACT_REF_TEST";
    const action = decideRetryGuard(ref, { ok: false });
    if (action.kind !== "resume_poll") assert.fail("expected resume_poll");
    assert.equal(action.priorRef, ref);
  });
});
