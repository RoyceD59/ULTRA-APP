/**
 * Pure, dependency-free decision function for the M-Pesa double-charge guard.
 *
 * When the customer taps "Try again" after a timeout, `handleMpesa` in
 * checkout.tsx queries the status of the prior STK push **before** sending a
 * new one.  This module captures that decision so the branching can be
 * unit-tested without React Native, Alert, or network I/O.
 *
 * Decisions:
 *
 *   use_prior    — prior push confirmed paid; create the order from it,
 *                  do NOT issue a second push.
 *
 *   resume_poll  — prior push is still in-flight (pending, network error,
 *                  or any unexpected status); resume polling it,
 *                  do NOT issue a second push.  This is the safe default
 *                  whenever the outcome is uncertain.
 *
 *   fresh_push   — prior push definitively failed (status === "failed");
 *                  safe to clear the ref and issue a brand-new push.
 */

import type { MpesaStatusResponse } from "./mpesaStatusClassifier.js";

export type RetryGuardAction =
  | { kind: "use_prior";   priorRef: string }
  | { kind: "resume_poll"; priorRef: string }
  | { kind: "fresh_push" };

/**
 * Decide what to do on "Try again" given the status of the most-recent prior
 * STK push.
 *
 * @param priorRef  The CheckoutRequestID stored from the prior push.
 * @param result    Either the resolved status response or a network error.
 *
 * Invariant: `fresh_push` is only returned when the status is definitively
 * "failed".  In every uncertain case — pending, unknown status, or network
 * error — the function returns `resume_poll` so we never risk double-charging.
 */
export function decideRetryGuard(
  priorRef: string,
  result: { ok: true; response: MpesaStatusResponse } | { ok: false },
): RetryGuardAction {
  if (!result.ok) {
    // Network error — cannot confirm the prior push is dead.
    // Resume polling it; do NOT issue a new push.
    return { kind: "resume_poll", priorRef };
  }

  const { response } = result;

  if (response.status === "success") {
    // Original push confirmed paid — create the order from it.
    return { kind: "use_prior", priorRef };
  }

  if (response.status === "failed") {
    // Definitive failure — safe to send a fresh push.
    return { kind: "fresh_push" };
  }

  // "pending" or any unexpected status — the push may still succeed.
  // Resume polling; do NOT issue a new push.
  return { kind: "resume_poll", priorRef };
}
