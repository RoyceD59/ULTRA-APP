-- Migration: create uc_referral_codes and uc_referral_users tables
-- These tables persist referral-programme data (codes, credits, conversions,
-- and per-user signup associations) so data survives server restarts.
-- All statements are idempotent (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS uc_referral_codes (
  id                serial       PRIMARY KEY,
  code              varchar(40)  NOT NULL,
  owner_email       text         NOT NULL,
  owner_name        varchar(255) NOT NULL DEFAULT '',
  referred_emails   json         NOT NULL DEFAULT '[]'::json,
  conversions       integer      NOT NULL DEFAULT 0,
  credits_earned_kes integer     NOT NULL DEFAULT 0,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uc_referral_codes_code_idx
  ON uc_referral_codes (code);

CREATE UNIQUE INDEX IF NOT EXISTS uc_referral_codes_owner_email_idx
  ON uc_referral_codes (owner_email);

CREATE TABLE IF NOT EXISTS uc_referral_users (
  id               serial       PRIMARY KEY,
  email            text         NOT NULL,
  referred_by_code varchar(40),
  first_order_done boolean      NOT NULL DEFAULT false,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uc_referral_users_email_idx
  ON uc_referral_users (email);

CREATE INDEX IF NOT EXISTS uc_referral_users_referred_by_code_idx
  ON uc_referral_users (referred_by_code);
