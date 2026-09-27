-- Migration: add last_error and last_error_at to sheet_syncs
-- Applied automatically via `drizzle-kit push` in the post-merge setup script.
-- Safe to run multiple times (IF NOT EXISTS guards each column).

ALTER TABLE sheet_syncs
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;
