-- Migration: add callback_token column to mpesa_stk_initiations
-- Applied automatically via `drizzle-kit push` in the post-merge setup script.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
--
-- Purpose: stores a per-push UUID token embedded in the Safaricom CallBackURL
-- as ?token=<callbackToken>.  Using a per-push token instead of the long-lived
-- shared webhook secret limits the blast radius if a token is captured in
-- HTTP access logs: each token is valid for one STK push only (tied to this row)
-- and expires with the initiation record's expiresAt.
-- Existing rows (null) fall back to shared-secret verification for backward compat.

ALTER TABLE mpesa_stk_initiations
  ADD COLUMN IF NOT EXISTS callback_token text;
