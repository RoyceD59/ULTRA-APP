/**
 * M-Pesa poll cancel-guard helpers.
 *
 * These two functions implement the core "stale callback" contract used by
 * startMpesaPoll and both cancel paths (Cancel button + method-picker) in
 * checkout.tsx.  Extracting them into a separate module means:
 *
 *   1. The exact same logic is exercised in tests — no parallel simulation.
 *   2. Any change to the guard contract immediately breaks the test suite.
 *
 * Design invariant (enforced by tests in mpesaCancelGuard.test.mts):
 *   – cancelMpesaPoll  increments attemptRef BEFORE clearing the interval.
 *   – isCancelledAttempt checks strict inequality (===), not >=.
 *   Changing either breaks the discard guarantee.
 */

type Ref<T> = { current: T };

/**
 * Increment the attempt counter and clear any active poll interval.
 *
 * Called by:
 *   - The "Cancel" button onPress (checkout.tsx ~line 604)
 *   - The payment-method picker onChange (checkout.tsx ~line 642)
 *
 * Callers are responsible for also calling setMpesaWaiting(false) and
 * setProcessing(false) — those are UI state and outside this module's scope.
 */
export function cancelMpesaPoll(
  attemptRef: Ref<number>,
  pollRef: Ref<ReturnType<typeof setInterval> | null>,
): void {
  attemptRef.current++;
  if (pollRef.current !== null) {
    clearInterval(pollRef.current);
    pollRef.current = null;
  }
}

/**
 * Returns true when the given attempt has been superseded by a newer one.
 *
 * Used as the pre-await and post-await guard inside the startMpesaPoll
 * interval tick.  A stale callback (cancelled, timed-out, or superseded)
 * must return immediately without calling createOrder or touching state.
 *
 * Example usage (matches checkout.tsx):
 *
 *   // Pre-await guard — first line of the interval callback
 *   if (isCancelledAttempt(thisAttempt, attemptRef)) { clearInterval(id); return; }
 *
 *   const status = await api.mpesaStatus(checkoutRequestId);
 *
 *   // Post-await guard — checked again after every async operation
 *   if (isCancelledAttempt(thisAttempt, attemptRef)) return;
 */
export function isCancelledAttempt(
  thisAttempt: number,
  attemptRef: Ref<number>,
): boolean {
  return attemptRef.current !== thisAttempt;
}
