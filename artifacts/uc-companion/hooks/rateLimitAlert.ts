/**
 * Single source of truth for how the app reacts to an HTTP 429 (rate limit).
 *
 * Pure, dependency-free module (no react-native / Expo imports) so the
 * decision logic can be unit-tested under node:test.  The screens own the
 * side-effects (Alert.alert etc.); this module only decides *whether* an
 * error is a rate limit and *what* the alert must say.
 *
 * Contract (see the checkout / auth rate-limit tests):
 *   - The alert message is exactly RATE_LIMIT_MESSAGE.
 *   - The alert has ONLY a default OK/dismiss button — never "Try again" or
 *     "Pay with COD" buttons.  An immediate retry button would let the user
 *     bypass the rate limit by tapping again.
 *   - For the M-Pesa flow the phone-number modal stays open (the caller must
 *     not close it), but no automatic or one-tap retry is offered.
 */

export const RATE_LIMIT_TITLE = 'Too Many Attempts';

export const RATE_LIMIT_MESSAGE =
  'Too many attempts. Please wait a minute before trying again.';

/** Minimal structural shape of ApiError needed to detect a rate limit. */
export interface RateLimitCheckable {
  status?: unknown;
  rateLimited?: unknown;
}

/**
 * True when `e` represents an HTTP 429 response.  Accepts anything and
 * checks structurally so it is safe to call with unknown catch values.
 */
export function isRateLimitError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as RateLimitCheckable;
  return err.rateLimited === true || err.status === 429;
}

export type PaymentErrorAction =
  /** 429 — show RATE_LIMIT_MESSAGE with only an OK button, no retry path. */
  | { kind: 'rate_limited'; title: string; message: string }
  /** Transient blip (5xx / network) — safe to offer "Try again / COD". */
  | { kind: 'retry_dialog' }
  /** Permanent failure (declined card, bad input) — no retry button. */
  | { kind: 'declined' };

/**
 * Classify an error thrown by a payment-initiation call (Paystack init,
 * Stripe session, M-Pesa STK push) into the dialog the checkout must show.
 *
 * `e` may be an ApiError, a plain Error (network failure), or anything else.
 * Non-ApiError values are treated as transient (retryable) to preserve the
 * existing checkout behaviour for network errors.
 */
export function classifyPaymentInitError(e: unknown): PaymentErrorAction {
  if (isRateLimitError(e)) {
    return { kind: 'rate_limited', title: RATE_LIMIT_TITLE, message: RATE_LIMIT_MESSAGE };
  }
  const retryable =
    typeof e === 'object' && e !== null && 'retryable' in e
      ? (e as { retryable?: unknown }).retryable === true
      : true; // non-ApiError (network blip) → retryable
  return retryable ? { kind: 'retry_dialog' } : { kind: 'declined' };
}

/**
 * Map an auth (login / register / social) response to the error message the
 * screen must show, or null on success.  Mirrors the branching inside
 * AuthContext so the 429 wording is testable and consistent app-wide.
 */
export function authErrorMessage(
  status: number,
  ok: boolean,
  serverError: string | undefined,
  fallback: string,
): string | null {
  if (status === 429) return serverError || RATE_LIMIT_MESSAGE;
  if (!ok || serverError) return serverError || fallback;
  return null;
}
