-- Migration: create uc_filter_reminders table
-- Applied automatically via `drizzle-kit push` in the post-merge setup script.
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
--
-- Purpose: server-side mirror of each customer's active filter registration.
-- The daily reminder-dispatch job reads this table to deliver the 5-stage
-- filter lifecycle messages (activation / day30 / day60 / replace30 / replace15)
-- via email, SMS, or WhatsApp for users who opted in via uc_notif_prefs.
-- sentStages (jsonb array) records which stages have been atomically claimed
-- this cycle so concurrent dispatch runs can never double-send.

CREATE TABLE IF NOT EXISTS uc_filter_reminders (
  user_id        text        PRIMARY KEY,
  product_id     integer     NOT NULL,
  product_name   text        NOT NULL,
  lifespan_days  integer     NOT NULL DEFAULT 0,
  activated_at   timestamptz NOT NULL,
  source_order_id integer,
  sent_stages    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
