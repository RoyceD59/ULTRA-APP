/**
 * Shared rate-limiter instances.
 *
 * authLimiter   — 10 requests / minute per IP for login, register, and
 *                 forgot-password endpoints.  Prevents brute-force password
 *                 guessing and credential-stuffing attacks.
 *
 * paymentLimiter — 5 requests / minute per IP for M-Pesa, Paystack, and
 *                  Stripe initiation endpoints.  Each call triggers a real
 *                  STK push or a billable API call; flooding must be stopped
 *                  before it reaches the payment provider.
 */

import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 10,
  standardHeaders: true, // Return rate-limit info in the `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    error:
      "Too many attempts. Please wait a minute before trying again.",
  },
  skipSuccessfulRequests: false,
});

export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Too many payment requests. Please wait a minute before trying again.",
  },
  skipSuccessfulRequests: false,
});

// The private Companion proxy does not forward caller-controlled IP headers.
// Validated immutable-order capabilities, not that proxy's shared IP, scope
// guest limits. Status polling cannot consume initiation's separate allowance.
const guestOrderKey = (_req: unknown, res: import("express").Response) => {
  const id = res.locals.guestPay?.order?.id;
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error("Validated guest order required");
  return `guest-order:${id}`;
};
export const guestStatusLimiter = rateLimit({
  windowMs: 60_000, max: 60, keyGenerator: guestOrderKey,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many status checks for this order. Wait a minute and check the original payment.", retryable: false },
});
export const guestInitializationLimiter = rateLimit({
  windowMs: 60_000, max: 6, keyGenerator: guestOrderKey,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many attempts for this order. Wait a minute and check its payment status.", retryable: false },
});
// Unknown capabilities have no order identity. Abuse protection for them is
// separate, so exhausting this peer/IP budget cannot block valid payers.
export const invalidGuestLimiter = rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many invalid payment-link requests.", retryable: false },
});

/**
 * lookupLimiter — 10 requests / minute per IP for record-lookup endpoints
 * that accept guessable identifiers (e.g. registering a filter by receipt
 * number + phone). Stops enumeration/fishing for other customers' orders.
 */
export const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Too many attempts. Please wait a minute before trying again.",
  },
  skipSuccessfulRequests: false,
});

export const locationQualityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many rating requests. Please try again later." },
});
