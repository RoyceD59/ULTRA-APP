/**
 * Tests for the M-Pesa cancel-guard functions in mpesaPollManager.ts.
 *
 * These tests import the REAL production functions — cancelMpesaPoll and
 * isCancelledAttempt — so any change to the guard contract in mpesaPollManager.ts
 * will immediately break the relevant assertions here.
 *
 * The checkout screen (app/checkout.tsx) uses these two functions to prevent
 * stale poll callbacks from acting after the customer taps Cancel:
 *
 *   cancelMpesaPoll(attemptRef, pollRef)
 *     Called by the Cancel button and the payment-method picker.
 *     Increments attemptRef.current and clears the active interval.
 *
 *   isCancelledAttempt(thisAttempt, attemptRef)
 *     Used as the pre-await and post-await guard in every interval tick.
 *     Returns true (discard) when a newer attempt has started.
 *
 * Covers:
 *   (a) cancelMpesaPoll increments attemptRef and clears pollRef
 *   (b) isCancelledAttempt returns true for stale attempts (pre-await guard)
 *   (c) isCancelledAttempt returns false for the active attempt (tick proceeds)
 *   (d) Full cancel scenario: stale tick is discarded, UI state resets
 *   (e) Rapid cancel → retry → cancel: stale callbacks from both prior attempts
 *       are discarded; only the final attempt's ticks can reach createOrder
 *   (f) Post-await guard: cancel during an in-flight network call is caught
 *       after the await resolves
 *   (g) cancelMpesaPoll is idempotent — double-cancel leaves state consistent
 *
 * Run with: pnpm --filter @workspace/uc-companion test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cancelMpesaPoll, isCancelledAttempt } from '../mpesaPollManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Ref<T> = { current: T };

function makeAttemptRef(initial = 0): Ref<number> {
  return { current: initial };
}

function makePollRef(): Ref<ReturnType<typeof setInterval> | null> {
  return { current: null };
}

/**
 * Register a no-op interval so pollRef.current is non-null (simulates an active poll).
 * `.unref()` is called immediately so this timer never prevents Node.js from exiting —
 * tests that don't cancel the interval explicitly won't cause the process to hang.
 */
function startFakeInterval(pollRef: Ref<ReturnType<typeof setInterval> | null>): void {
  const id = setInterval(() => { /* no-op */ }, 60_000);
  (id as unknown as { unref(): void }).unref?.();
  pollRef.current = id;
}

/**
 * Simulate one interval tick using the real isCancelledAttempt guard.
 *
 * Mirrors the exact guard pattern in startMpesaPoll (checkout.tsx):
 *
 *   // Pre-await guard
 *   if (isCancelledAttempt(thisAttempt, attemptRef)) { clearInterval(id); return; }
 *
 *   await networkDelay;   // api.mpesaStatus() in production
 *
 *   // Post-await guard
 *   if (isCancelledAttempt(thisAttempt, attemptRef)) return;
 *
 *   // Would call createOrder(...)
 */
async function runTick(
  thisAttempt: number,
  attemptRef: Ref<number>,
  networkDelay: Promise<void> = Promise.resolve(),
): Promise<'discarded_pre' | 'discarded_post' | 'reached_create_order'> {
  // Pre-await guard (first line of interval callback)
  if (isCancelledAttempt(thisAttempt, attemptRef)) return 'discarded_pre';

  await networkDelay;

  // Post-await guard (after every async operation)
  if (isCancelledAttempt(thisAttempt, attemptRef)) return 'discarded_post';

  return 'reached_create_order';
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) cancelMpesaPoll — ref mutations
// ─────────────────────────────────────────────────────────────────────────────

describe('cancelMpesaPoll — ref mutations', () => {
  it('increments attemptRef.current by 1', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    cancelMpesaPoll(attemptRef, pollRef);
    assert.equal(attemptRef.current, 1, 'attemptRef must be incremented to 1 after one cancel');
  });

  it('increments attemptRef.current on each call', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    cancelMpesaPoll(attemptRef, pollRef);
    cancelMpesaPoll(attemptRef, pollRef);
    cancelMpesaPoll(attemptRef, pollRef);
    assert.equal(attemptRef.current, 3, 'each cancel must increment attemptRef by 1');
  });

  it('sets pollRef.current to null when an interval is active', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);
    assert.notEqual(pollRef.current, null, 'pollRef must be non-null before cancel');
    cancelMpesaPoll(attemptRef, pollRef);
    assert.equal(pollRef.current, null, 'pollRef must be null after cancel');
  });

  it('leaves pollRef.current null when no interval is active (safe no-op)', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef(); // already null
    cancelMpesaPoll(attemptRef, pollRef);
    assert.equal(pollRef.current, null, 'pollRef remains null — no crash when already cleared');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) isCancelledAttempt — stale detection
// ─────────────────────────────────────────────────────────────────────────────

describe('isCancelledAttempt — stale detection', () => {
  it('returns true when attemptRef has moved ahead (stale tick)', () => {
    const attemptRef = makeAttemptRef(1); // cancel incremented it
    const staleAttempt = 0;
    assert.ok(
      isCancelledAttempt(staleAttempt, attemptRef),
      'isCancelledAttempt must return true for a stale thisAttempt — tick must be discarded',
    );
  });

  it('returns false when thisAttempt matches attemptRef (active tick)', () => {
    const attemptRef = makeAttemptRef(1);
    const activeAttempt = 1;
    assert.ok(
      !isCancelledAttempt(activeAttempt, attemptRef),
      'isCancelledAttempt must return false for the active attempt — tick must proceed',
    );
  });

  it('returns true immediately after cancelMpesaPoll is called', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    const thisAttempt = attemptRef.current; // 0
    cancelMpesaPoll(attemptRef, pollRef);   // increments to 1
    assert.ok(
      isCancelledAttempt(thisAttempt, attemptRef),
      'isCancelledAttempt must return true for the pre-cancel thisAttempt after cancel',
    );
  });

  it('returns false for the new attempt immediately after cancelMpesaPoll', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    cancelMpesaPoll(attemptRef, pollRef);          // attemptRef → 1
    const newAttempt = attemptRef.current;          // 1
    assert.ok(
      !isCancelledAttempt(newAttempt, attemptRef),
      'isCancelledAttempt must return false for the new attempt stamped after cancel',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Active tick proceeds to createOrder
// ─────────────────────────────────────────────────────────────────────────────

describe('isCancelledAttempt — active tick reaches createOrder', () => {
  it('runTick returns reached_create_order when no cancel has fired', async () => {
    const attemptRef = makeAttemptRef(0);
    const result = await runTick(0, attemptRef);
    assert.equal(
      result,
      'reached_create_order',
      'active tick must pass both guards and reach the createOrder call',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Full cancel scenario: stale tick discarded, UI can reset
// ─────────────────────────────────────────────────────────────────────────────

describe('Full cancel scenario — stale tick is discarded', () => {
  it('tick from a cancelled attempt is discarded by the pre-await guard', async () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);

    const thisAttempt = attemptRef.current; // 0

    // Customer taps Cancel
    cancelMpesaPoll(attemptRef, pollRef);

    const result = await runTick(thisAttempt, attemptRef);
    assert.equal(
      result,
      'discarded_pre',
      'stale tick must be discarded by isCancelledAttempt pre-await guard — createOrder must not fire',
    );
  });

  it('cancelMpesaPoll resets pollRef so no further interval ticks can fire', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);

    cancelMpesaPoll(attemptRef, pollRef);

    assert.equal(pollRef.current, null, 'pollRef must be null after cancel — interval is stopped');
  });

  it('multiple stale ticks after cancel are all discarded', async () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    const thisAttempt = attemptRef.current;

    cancelMpesaPoll(attemptRef, pollRef);

    for (let i = 0; i < 5; i++) {
      const result = await runTick(thisAttempt, attemptRef);
      assert.equal(result, 'discarded_pre', `stale tick #${i + 1} must be discarded`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) Rapid cancel → retry → cancel
// ─────────────────────────────────────────────────────────────────────────────

describe('Rapid cancel → retry → cancel — only the final attempt is active', () => {
  it('attempt-1 tick is discarded after cancel; attempt-2 tick reaches createOrder', async () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);

    const attempt1 = attemptRef.current; // 0

    // First cancel
    cancelMpesaPoll(attemptRef, pollRef); // attemptRef → 1

    // Retry: handleMpesa stamps a new attempt (++attemptRef, as in checkout.tsx)
    attemptRef.current++;
    const attempt2 = attemptRef.current; // 2
    startFakeInterval(pollRef);

    // attempt-1 tick — must be discarded
    const stale = await runTick(attempt1, attemptRef);
    assert.equal(stale, 'discarded_pre', 'attempt-1 tick must be discarded after first cancel');

    // attempt-2 tick — must proceed (no further cancel yet)
    const fresh = await runTick(attempt2, attemptRef);
    assert.equal(fresh, 'reached_create_order', 'attempt-2 tick must reach createOrder');
  });

  it('after cancel → retry → cancel, both prior attempts are discarded', async () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);

    const attempt1 = attemptRef.current; // 0

    cancelMpesaPoll(attemptRef, pollRef); // → 1

    // Retry
    attemptRef.current++;
    const attempt2 = attemptRef.current; // 2
    startFakeInterval(pollRef);

    // Second cancel
    cancelMpesaPoll(attemptRef, pollRef); // → 3

    const stale1 = await runTick(attempt1, attemptRef);
    assert.equal(stale1, 'discarded_pre', 'attempt-1 tick must be discarded after two cancels');

    const stale2 = await runTick(attempt2, attemptRef);
    assert.equal(stale2, 'discarded_pre', 'attempt-2 tick must also be discarded after second cancel');
  });

  it('a third retry after rapid double-cancel can reach createOrder', async () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();

    // Two cancels in a row
    cancelMpesaPoll(attemptRef, pollRef); // → 1
    cancelMpesaPoll(attemptRef, pollRef); // → 2

    // Third retry
    attemptRef.current++;
    const attempt3 = attemptRef.current; // 3

    const result = await runTick(attempt3, attemptRef);
    assert.equal(result, 'reached_create_order', 'fresh attempt after rapid double-cancel must reach createOrder');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) Post-await guard: cancel fires during in-flight network call
// ─────────────────────────────────────────────────────────────────────────────

describe('Post-await guard — cancel during in-flight network call', () => {
  it('cancel during network call is caught by isCancelledAttempt post-await', async () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);

    const thisAttempt = attemptRef.current;

    // Build a network delay we can resolve manually
    let resolveNetwork!: () => void;
    const networkDelay = new Promise<void>((resolve) => { resolveNetwork = resolve; });

    // Start the tick — pauses at the await
    const tickPromise = runTick(thisAttempt, attemptRef, networkDelay);

    // Cancel fires while the network call is in-flight
    cancelMpesaPoll(attemptRef, pollRef);

    // Network call resolves — post-await guard should catch the cancel
    resolveNetwork();

    const result = await tickPromise;
    assert.equal(
      result,
      'discarded_post',
      'cancel during in-flight network call must be caught by isCancelledAttempt post-await guard',
    );
  });

  it('mid-flight cancel does not prevent a subsequent fresh retry from reaching createOrder', async () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);

    const thisAttempt = attemptRef.current;

    let resolveNetwork!: () => void;
    const networkDelay = new Promise<void>((r) => { resolveNetwork = r; });

    // Stale tick in-flight
    const staleTickPromise = runTick(thisAttempt, attemptRef, networkDelay);

    // Cancel fires
    cancelMpesaPoll(attemptRef, pollRef);

    // Retry stamps a new attempt
    attemptRef.current++;
    const freshAttempt = attemptRef.current;

    // Stale network resolves — must be discarded post-await
    resolveNetwork();
    assert.equal(await staleTickPromise, 'discarded_post', 'stale in-flight tick must be discarded post-await');

    // Fresh retry proceeds
    const freshResult = await runTick(freshAttempt, attemptRef);
    assert.equal(freshResult, 'reached_create_order', 'fresh retry must reach createOrder unaffected by the stale discard');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (h) Entry-modal Cancel invalidates an in-flight STK-push attempt
//
// The M-Pesa entry modal has a Cancel button that previously only called
// setShowMpesaModal(false).  If handleMpesa was already called (processing=true)
// and the STK-push request was in-flight, the async callbacks would continue and
// eventually show the waiting screen even though the user tapped Cancel.
//
// The fix: the entry-modal Cancel now calls cancelMpesaPoll(attemptRef, pollRef)
// before closing the modal.  This increments attemptRef so every subsequent
// isCancelledAttempt check in handleMpesa's callbacks returns true → discarded.
// ─────────────────────────────────────────────────────────────────────────────

describe('entry-modal Cancel guard — STK push in-flight cancellation', () => {
  it('cancel before STK response: increments attemptRef so in-flight callbacks are stale', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef    = makePollRef();

    // Simulate handleMpesa starting: capture thisAttempt and set processing=true
    attemptRef.current += 1;          // handleMpesa does ++attemptRef.current
    const thisAttempt = attemptRef.current; // 1

    // STK-push request is now in-flight.
    // User taps Cancel in the entry modal — this is what the fix applies:
    cancelMpesaPoll(attemptRef, pollRef); // increments → 2, clears pollRef

    // The in-flight STK-push response eventually resolves and checks the guard:
    const discarded = isCancelledAttempt(thisAttempt, attemptRef);
    assert.ok(discarded,
      'attempt captured before entry-modal cancel must be stale after cancel');
  });

  it('cancel then retry: new attempt is not stale, old one still is', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef    = makePollRef();

    // First handleMpesa call
    attemptRef.current += 1;
    const firstAttempt = attemptRef.current; // 1

    // Entry-modal Cancel
    cancelMpesaPoll(attemptRef, pollRef); // → 2

    // Customer re-enters number and taps "Send Payment Request" again
    attemptRef.current += 1;
    const secondAttempt = attemptRef.current; // 3

    assert.ok(isCancelledAttempt(firstAttempt, attemptRef),
      'first attempt must be stale after cancel+retry');
    assert.ok(!isCancelledAttempt(secondAttempt, attemptRef),
      'second attempt must NOT be stale — it is the current live attempt');
  });

  it('cancel before poll starts: no interval to clear, state is still reset correctly', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef    = makePollRef(); // pollRef.current is null (no interval yet)

    // handleMpesa started (processing=true) but hasn't reached the poll yet
    attemptRef.current += 1;
    const thisAttempt = attemptRef.current;

    // Entry-modal Cancel fires before the poll interval is set
    cancelMpesaPoll(attemptRef, pollRef);

    assert.equal(pollRef.current, null, 'pollRef stays null when no interval was active');
    assert.ok(isCancelledAttempt(thisAttempt, attemptRef),
      'attempt is stale even without an active poll interval');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) cancelMpesaPoll is idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe('cancelMpesaPoll — idempotent (double-cancel safe)', () => {
  it('double-cancel leaves pollRef null and attemptRef incremented twice', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();
    startFakeInterval(pollRef);

    cancelMpesaPoll(attemptRef, pollRef); // first cancel
    cancelMpesaPoll(attemptRef, pollRef); // second cancel — pollRef already null

    assert.equal(pollRef.current, null, 'pollRef must still be null after double-cancel');
    assert.equal(attemptRef.current, 2, 'each cancel increments attemptRef — two cancels → 2');
  });

  it('after double-cancel, both prior thisAttempt values are stale', () => {
    const attemptRef = makeAttemptRef(0);
    const pollRef = makePollRef();

    const attempt0 = attemptRef.current; // 0
    cancelMpesaPoll(attemptRef, pollRef); // → 1
    const attempt1 = 1;                   // captured between cancels for the test
    cancelMpesaPoll(attemptRef, pollRef); // → 2

    assert.ok(isCancelledAttempt(attempt0, attemptRef), 'attempt 0 must be stale after double-cancel');
    assert.ok(isCancelledAttempt(attempt1, attemptRef), 'attempt 1 must also be stale after second cancel');
    assert.ok(!isCancelledAttempt(2, attemptRef),        'attempt 2 (current) must NOT be stale');
  });
});
