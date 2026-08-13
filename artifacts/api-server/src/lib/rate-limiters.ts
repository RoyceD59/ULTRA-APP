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
