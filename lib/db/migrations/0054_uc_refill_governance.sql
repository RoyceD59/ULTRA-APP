-- Additive governance only. No customer credit, vendor volume or cash is posted here.
-- Apply to a backed-up database before exposing governance routes. Existing UC
-- accounts, rewards, orders, impact and payments are left untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS uc_refill_station_actions (
  id bigserial PRIMARY KEY,
  station_id text NOT NULL REFERENCES uc_locations(id),
  action text NOT NULL,
  actor_id text NOT NULL REFERENCES team_users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_refill_station_action_valid CHECK (action IN ('enable', 'suspend')),
  CONSTRAINT uc_refill_station_reason_valid CHECK (length(trim(reason)) BETWEEN 8 AND 500)
);
CREATE INDEX IF NOT EXISTS uc_refill_station_actions_latest_idx
  ON uc_refill_station_actions(station_id, id DESC);

CREATE TABLE IF NOT EXISTS uc_refill_operator_actions (
  id bigserial PRIMARY KEY,
  station_id text NOT NULL REFERENCES uc_locations(id),
  operator_id text NOT NULL REFERENCES team_users(id),
  action text NOT NULL,
  station_enable_event_id bigint REFERENCES uc_refill_station_actions(id),
  actor_id text NOT NULL REFERENCES team_users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_refill_grant_requires_station_event CHECK (action = 'revoke' OR station_enable_event_id IS NOT NULL),
  CONSTRAINT uc_refill_operator_action_valid CHECK (action IN ('grant', 'revoke')),
  CONSTRAINT uc_refill_operator_reason_valid CHECK (length(trim(reason)) BETWEEN 8 AND 500)
);
CREATE INDEX IF NOT EXISTS uc_refill_operator_actions_latest_idx
  ON uc_refill_operator_actions(operator_id, station_id, id DESC);

CREATE TABLE IF NOT EXISTS uc_refill_campaign_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key text NOT NULL,
  version integer NOT NULL,
  station_id text NOT NULL REFERENCES uc_locations(id),
  pricing_version text NOT NULL,
  eligibility_policy text NOT NULL,
  credit_ml bigint NOT NULL,
  max_grants integer NOT NULL,
  sponsor_funding_minor bigint NOT NULL,
  cash_charge_minor bigint NOT NULL DEFAULT 0,
  costs_minor jsonb NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  proposal_hash text NOT NULL,
  proposed_by text NOT NULL REFERENCES team_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_refill_campaign_valid_window CHECK (ends_at > starts_at),
  CONSTRAINT uc_refill_campaign_key_valid CHECK (campaign_key ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  CONSTRAINT uc_refill_campaign_version_valid CHECK (version > 0),
  CONSTRAINT uc_refill_campaign_pricing_valid CHECK (length(trim(pricing_version)) BETWEEN 1 AND 100),
  CONSTRAINT uc_refill_campaign_eligibility_valid CHECK (eligibility_policy = 'manual_review'),
  CONSTRAINT uc_refill_campaign_quantities_valid CHECK (credit_ml > 0 AND max_grants > 0 AND sponsor_funding_minor >= 0 AND cash_charge_minor = 0),
  CONSTRAINT uc_refill_campaign_costs_valid CHECK (jsonb_typeof(costs_minor) = 'object'),
  CONSTRAINT uc_refill_campaign_hash_valid CHECK (proposal_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_refill_campaign_station_version
  ON uc_refill_campaign_versions(campaign_key, station_id, version);
CREATE INDEX IF NOT EXISTS uc_refill_campaign_versions_station_idx
  ON uc_refill_campaign_versions(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS uc_refill_campaign_actions (
  id bigserial PRIMARY KEY,
  campaign_version_id uuid NOT NULL REFERENCES uc_refill_campaign_versions(id),
  action text NOT NULL,
  actor_id text NOT NULL REFERENCES team_users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_refill_campaign_action_valid CHECK (action IN ('approve', 'suspend')),
  CONSTRAINT uc_refill_campaign_action_reason_valid CHECK (length(trim(reason)) BETWEEN 8 AND 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_refill_campaign_action_once
  ON uc_refill_campaign_actions(campaign_version_id, action);
CREATE INDEX IF NOT EXISTS uc_refill_campaign_actions_latest_idx
  ON uc_refill_campaign_actions(campaign_version_id, id DESC);

-- Definitions and audit actions are append-only. A corrected rule requires a
-- new version; a suspended version cannot be silently reactivated.
CREATE OR REPLACE FUNCTION uc_refill_reject_immutable_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Controlled refill governance records are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS uc_refill_station_actions_immutable ON uc_refill_station_actions;
CREATE TRIGGER uc_refill_station_actions_immutable BEFORE UPDATE OR DELETE
  ON uc_refill_station_actions FOR EACH ROW EXECUTE FUNCTION uc_refill_reject_immutable_change();
DROP TRIGGER IF EXISTS uc_refill_operator_actions_immutable ON uc_refill_operator_actions;
CREATE TRIGGER uc_refill_operator_actions_immutable BEFORE UPDATE OR DELETE
  ON uc_refill_operator_actions FOR EACH ROW EXECUTE FUNCTION uc_refill_reject_immutable_change();
DROP TRIGGER IF EXISTS uc_refill_campaign_versions_immutable ON uc_refill_campaign_versions;
CREATE TRIGGER uc_refill_campaign_versions_immutable BEFORE UPDATE OR DELETE
  ON uc_refill_campaign_versions FOR EACH ROW EXECUTE FUNCTION uc_refill_reject_immutable_change();
DROP TRIGGER IF EXISTS uc_refill_campaign_actions_immutable ON uc_refill_campaign_actions;
CREATE TRIGGER uc_refill_campaign_actions_immutable BEFORE UPDATE OR DELETE
  ON uc_refill_campaign_actions FOR EACH ROW EXECUTE FUNCTION uc_refill_reject_immutable_change();
COMMIT;