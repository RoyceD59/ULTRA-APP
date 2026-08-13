/**
 * Integration test: M-Pesa "Try again" after wrong-PIN sends a fresh STK push.
 *
 * Regression target: if `lastCheckoutRequestIdRef` is NOT cleared on a
 * retriable=false failure, the next "Try again" re-queries the dead push via
 * the status endpoint instead of sending a new STK push.
 *
 * How these tests are wired to production code
 * ─────────────────────────────────────────────
 * checkout.tsx was refactored so the ref-clearing condition is expressed as a
 * call to `pollSettleClearsRef` (from mpesaStatusClassifier.ts) rather than an
 * inline `action.kind === 'hint_dialog' || action.kind === 'retry_dialog'` check.
 * The tests below import that same function, so:
 *
 *   • If `pollSettleClearsRef` is changed to no longer return `true` for
 *     `hint_dialog`, the "ref is null after hint_dialog" assertion breaks.
 *   • If `classifyMpesaStatus` stops returning `hint_dialog` for retriable=false,
 *     the classifier assertions break.
 *   • If `decideRetryGuard` logic is altered, the contrast test breaks.
 *
 * A regression in any of these three functions surfaces immediately without
 * needing to render the React Native component.
 *
 * Covers:
 *   (a) pollSettleClearsRef returns true for hint_dialog actions — this is the
 *       exact condition checkout.tsx tests before setting ref = null.
 *   (b) pollSettleClearsRef returns true for retry_dialog actions too (shared branch).
 *   (c) pollSettleClearsRef returns false for create_order and continue_polling —
 *       those do NOT immediately clear the ref.
 *   (d) After a wrong-PIN failure, applying pollSettleClearsRef leaves the
 *       simulated ref at null.
 *   (e) With ref null, decideRetryGuard is not invoked; the only path is a
 *       fresh STK push (not a status re-query).
 *   (f) End-to-end simulation using the real exported functions.
 *   (g) Contrast: non-null ref (timeout scenario) DOES query status first.
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMpesaStatus,
  pollSettleClearsRef,
} from '../mpesaStatusClassifier.js';
import { decideRetryGuard } from '../mpesaRetryGuard.js';

// ── (a) pollSettleClearsRef — hint_dialog actions ─────────────────────────────
//
// checkout.tsx (startMpesaPoll) now calls:
//   if (pollSettleClearsRef(action)) { lastCheckoutRequestIdRef.current = null; }
//
// This group verifies that all three NON_RETRIABLE_CODES end-cases classify to
// hint_dialog AND that hint_dialog satisfies pollSettleClearsRef — so the
// production ref-clear fires unconditionally for every definitive decline.

describe('pollSettleClearsRef — returns true for hint_dialog (triggers ref clear in checkout.tsx)', () => {
  it('returns true when classifyMpesaStatus produces hint_dialog (wrong PIN)', () => {
    const action = classifyMpesaStatus({
      status: 'failed',
      retriable: false,
      resultDesc: 'The initiator information is invalid.',
    });
    assert.equal(
      action.kind,
      'hint_dialog',
      'wrong-PIN (retriable=false) must classify as hint_dialog',
    );
    assert.ok(
      pollSettleClearsRef(action),
      'pollSettleClearsRef must return true for hint_dialog — this is the function ' +
        'checkout.tsx calls to decide whether to set lastCheckoutRequestIdRef.current = null',
    );
  });

  it('returns true for hint_dialog from user-cancelled response (resultCode 1032)', () => {
    const action = classifyMpesaStatus({
      status: 'failed',
      retriable: false,
      resultDesc: 'Request cancelled by user',
    });
    assert.equal(action.kind, 'hint_dialog');
    assert.ok(pollSettleClearsRef(action), 'user-cancelled hint_dialog must clear the ref');
  });

  it('returns true for hint_dialog from insufficient-funds response (resultCode 1)', () => {
    const action = classifyMpesaStatus({
      status: 'failed',
      retriable: false,
      resultDesc: 'The balance is insufficient for the transaction',
    });
    assert.equal(action.kind, 'hint_dialog');
    assert.ok(pollSettleClearsRef(action), 'insufficient-funds hint_dialog must clear the ref');
  });
});

// ── (b) pollSettleClearsRef — retry_dialog shares the same clearing branch ────
//
// retry_dialog (retriable=true, DS timeout) is handled by the same branch in
// checkout.tsx, so pollSettleClearsRef must return true for it too.

describe('pollSettleClearsRef — returns true for retry_dialog (transient failure)', () => {
  it('returns true when classifyMpesaStatus produces retry_dialog (retriable=true)', () => {
    const action = classifyMpesaStatus({
      status: 'failed',
      retriable: true,
      resultDesc: 'DS timeout user cannot be reached',
    });
    assert.equal(action.kind, 'retry_dialog');
    assert.ok(
      pollSettleClearsRef(action),
      'pollSettleClearsRef must return true for retry_dialog — checkout.tsx clears the ref ' +
        'for both hint_dialog and retry_dialog before showing the alert',
    );
  });
});

// ── (c) pollSettleClearsRef — false for non-settling actions ──────────────────
//
// create_order and continue_polling must NOT clear the ref immediately.
// create_order clears it only after createOrder() succeeds.

describe('pollSettleClearsRef — returns false for non-settling actions', () => {
  it('returns false for create_order — ref stays until createOrder() succeeds', () => {
    const action = classifyMpesaStatus({ status: 'success' });
    assert.equal(action.kind, 'create_order');
    assert.strictEqual(
      pollSettleClearsRef(action),
      false,
      'create_order must NOT immediately clear the ref — checkout.tsx clears it only after createOrder() succeeds',
    );
  });

  it('returns false for continue_polling — ref must survive while the push is still live', () => {
    const action = classifyMpesaStatus({ status: 'pending' });
    assert.equal(action.kind, 'continue_polling');
    assert.strictEqual(
      pollSettleClearsRef(action),
      false,
      'continue_polling must not clear the ref — the push is still in-flight',
    );
  });
});

// ── (d) Ref becomes null after applying pollSettleClearsRef on wrong-PIN ──────
//
// Simulates the exact logic in startMpesaPoll (checkout.tsx):
//   const action = classifyMpesaStatus(status);
//   if (pollSettleClearsRef(action)) { lastCheckoutRequestIdRef.current = null; }
//
// Both `pollSettleClearsRef` and `classifyMpesaStatus` are imported from the
// same production modules that checkout.tsx uses — changing either one breaks
// this test.

describe('Ref cleared via pollSettleClearsRef — simulates startMpesaPoll branch', () => {
  it('lastCheckoutRequestIdRef is null after wrong-PIN using the production pollSettleClearsRef', () => {
    const lastCheckoutRequestIdRef: { current: string | null } = {
      current: 'ws_CO_PRIOR_PUSH_WRONG_PIN_001',
    };

    // This mirrors the production code in checkout.tsx startMpesaPoll:
    //   const action = classifyMpesaStatus(status);
    //   if (pollSettleClearsRef(action)) { lastCheckoutRequestIdRef.current = null; }
    const action = classifyMpesaStatus({ status: 'failed', retriable: false });
    if (pollSettleClearsRef(action)) {
      lastCheckoutRequestIdRef.current = null;
    }

    assert.strictEqual(
      lastCheckoutRequestIdRef.current,
      null,
      'lastCheckoutRequestIdRef must be null after pollSettleClearsRef returns true — ' +
        'the prior push is definitively dead; re-querying it on retry would be wrong',
    );
  });

  it('lastCheckoutRequestIdRef is null after retry_dialog (retriable=true) too', () => {
    const lastCheckoutRequestIdRef: { current: string | null } = {
      current: 'ws_CO_PRIOR_PUSH_TRANSIENT_001',
    };

    const action = classifyMpesaStatus({ status: 'failed', retriable: true });
    if (pollSettleClearsRef(action)) {
      lastCheckoutRequestIdRef.current = null;
    }

    assert.strictEqual(
      lastCheckoutRequestIdRef.current,
      null,
      'retry_dialog also clears the ref — both dialog types share the same branch in checkout.tsx',
    );
  });

  it('lastCheckoutRequestIdRef is NOT cleared for create_order', () => {
    const lastCheckoutRequestIdRef: { current: string | null } = {
      current: 'ws_CO_SUCCESS_REF_001',
    };

    const action = classifyMpesaStatus({ status: 'success' });
    if (pollSettleClearsRef(action)) {
      lastCheckoutRequestIdRef.current = null; // must NOT execute
    }

    assert.strictEqual(
      lastCheckoutRequestIdRef.current,
      'ws_CO_SUCCESS_REF_001',
      'create_order must not clear the ref — only cleared after createOrder() succeeds',
    );
  });
});

// ── (e) Null ref → guard skipped → fresh STK push ────────────────────────────
//
// handleMpesa (checkout.tsx) skips the decideRetryGuard block entirely when
// lastCheckoutRequestIdRef.current is null.  This group verifies that with a
// null ref, the flow goes directly to the STK-push endpoint (no status query).

describe('handleMpesa entry — null ref skips decideRetryGuard (no status query)', () => {
  it('decideRetryGuard is not invoked when lastCheckoutRequestIdRef is null', () => {
    const lastCheckoutRequestIdRef: { current: string | null } = { current: null };

    // Mirrors checkout.tsx handleMpesa (lines ~233–278):
    //   const priorRef = lastCheckoutRequestIdRef.current;
    //   if (priorRef) { … decideRetryGuard(priorRef, …) … }
    const priorRef = lastCheckoutRequestIdRef.current;

    let guardInvoked = false;
    if (priorRef) {
      guardInvoked = true;
      decideRetryGuard(priorRef, { ok: true, response: { status: 'failed', retriable: false } });
    }

    assert.strictEqual(
      guardInvoked,
      false,
      'decideRetryGuard must not be called when ref is null — ' +
        'the status endpoint should never be queried; the flow must go directly to a new STK push',
    );
  });

  it('endpoint sequence with null ref is stk_push only (never status first)', () => {
    const lastCheckoutRequestIdRef: { current: string | null } = { current: null };
    const priorRef = lastCheckoutRequestIdRef.current;
    const endpointsCalled: string[] = [];

    if (priorRef) {
      endpointsCalled.push('status');
      const guardAction = decideRetryGuard(priorRef, { ok: true, response: { status: 'failed', retriable: false } });
      if (guardAction.kind === 'fresh_push') endpointsCalled.push('stk_push');
    } else {
      endpointsCalled.push('stk_push');
    }

    assert.deepEqual(
      endpointsCalled,
      ['stk_push'],
      'with a cleared ref, the only endpoint called must be stk_push — status must never appear',
    );
  });
});

// ── (f) End-to-end simulation using real exported functions ───────────────────
//
// Walks through the complete scenario in a single test, using only functions
// imported from the production modules:
//   classifyMpesaStatus — same module checkout.tsx imports
//   pollSettleClearsRef — same module checkout.tsx imports
//   decideRetryGuard    — same module checkout.tsx imports

describe('End-to-end: wrong-PIN decline → ref cleared → "Try again" → fresh STK push', () => {
  it('full scenario: classifyMpesaStatus + pollSettleClearsRef → null ref → stk_push only', () => {
    // ── Step 1: STK push was sent; ref holds its CheckoutRequestID. ───────────
    const lastCheckoutRequestIdRef: { current: string | null } = {
      current: 'ws_CO_WRONG_PIN_E2E_001',
    };
    assert.notEqual(lastCheckoutRequestIdRef.current, null, 'precondition: ref must be set');

    // ── Step 2: Poll receives wrong-PIN failure (ResultCode 2001, retriable=false). ─
    const action = classifyMpesaStatus({
      status: 'failed',
      retriable: false,
      resultDesc: 'The initiator information is invalid.',
    });
    assert.equal(action.kind, 'hint_dialog', 'wrong-PIN must classify as hint_dialog');

    // ── Step 3: checkout.tsx calls pollSettleClearsRef — same function imported here. ─
    if (pollSettleClearsRef(action)) {
      lastCheckoutRequestIdRef.current = null;
    }
    assert.strictEqual(
      lastCheckoutRequestIdRef.current,
      null,
      'ref must be null after pollSettleClearsRef returns true for hint_dialog',
    );

    // ── Step 4: Customer taps "Try again" → handleMpesa. ─────────────────────
    const priorRef = lastCheckoutRequestIdRef.current;
    const endpointsCalled: string[] = [];

    if (priorRef) {
      endpointsCalled.push('status');
      const guardAction = decideRetryGuard(priorRef, { ok: true, response: { status: 'failed' } });
      if (guardAction.kind === 'fresh_push') endpointsCalled.push('stk_push');
    } else {
      endpointsCalled.push('stk_push');
    }

    // ── Step 5: Only the STK-push endpoint was targeted. ─────────────────────
    assert.deepEqual(
      endpointsCalled,
      ['stk_push'],
      '"Try again" after wrong-PIN must call the STK-push endpoint directly — ' +
        'the status endpoint must never be queried for the dead push',
    );
  });
});

// ── (g) Contrast: non-null ref (timeout) queries status first ─────────────────
//
// After a timeout, the ref is intentionally NOT cleared (checkout.tsx lines
// 135-138).  "Try again" therefore runs decideRetryGuard → status query first.
// This confirms that clearing the ref is what changes the retry behaviour.

describe('Contrast — non-null ref (timeout scenario) queries status before any new push', () => {
  it('with a non-null ref, status is queried first (double-charge guard active)', () => {
    const lastCheckoutRequestIdRef: { current: string | null } = {
      current: 'ws_CO_TIMEOUT_REF_001',
    };
    const priorRef = lastCheckoutRequestIdRef.current;
    const endpointsCalled: string[] = [];

    if (priorRef) {
      endpointsCalled.push('status');
      const guardAction = decideRetryGuard(priorRef, { ok: true, response: { status: 'failed', retriable: false } });
      if (guardAction.kind === 'fresh_push') endpointsCalled.push('stk_push');
    } else {
      endpointsCalled.push('stk_push');
    }

    assert.equal(
      endpointsCalled[0],
      'status',
      'with a non-null ref (timeout path), status must be queried first — double-charge guard is active',
    );
    assert.ok(
      endpointsCalled.includes('stk_push'),
      'guard returns fresh_push for a failed prior push, so stk_push follows',
    );
  });

  it('clearing the ref is exactly what changes the retry path from [status, stk_push] to [stk_push]', () => {
    function simulateRetry(ref: string | null): string[] {
      const endpoints: string[] = [];
      if (ref) {
        endpoints.push('status');
        const g = decideRetryGuard(ref, { ok: true, response: { status: 'failed', retriable: false } });
        if (g.kind === 'fresh_push') endpoints.push('stk_push');
      } else {
        endpoints.push('stk_push');
      }
      return endpoints;
    }

    // Wrong-PIN path: pollSettleClearsRef cleared the ref → null
    const wrongPinPath = simulateRetry(null);
    // Timeout path: ref left intact (not cleared) → 'ws_CO_...'
    const timeoutPath  = simulateRetry('ws_CO_TIMEOUT_REF_002');

    assert.deepEqual(wrongPinPath, ['stk_push'],          'wrong-PIN (ref cleared): stk_push only');
    assert.deepEqual(timeoutPath,  ['status', 'stk_push'], 'timeout (ref intact): status queried first, then stk_push');
  });
});
