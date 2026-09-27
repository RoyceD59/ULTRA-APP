-- Migration: create mpesa_stk_initiations table
-- Applied automatically via `drizzle-kit push` in the post-merge setup script.
-- Safe to run multiple times (IF NOT EXISTS guards on every statement).
--
-- Purpose: stores server-side records of every M-Pesa STK push we initiate.
-- The callback handler requires an entry here before creating or advancing any
-- order, proving the push originated from this application and preventing an
-- attacker with a foreign CheckoutRequestID from triggering fulfillment.

CREATE TABLE IF NOT EXISTS mpesa_stk_initiations (
  id                   serial       PRIMARY KEY,
  checkout_request_id  text         NOT NULL,
  expected_amount      integer      NOT NULL,   -- KES, whole units
  phone                text         NOT NULL,   -- normalised e.g. "254712345678"
  created_at           timestamptz  NOT NULL DEFAULT now(),
  expires_at           timestamptz  NOT NULL    -- callback not honoured after this
);

CREATE UNIQUE INDEX IF NOT EXISTS mpesa_stk_initiations_checkout_request_id_unique
  ON mpesa_stk_initiations (checkout_request_id);
