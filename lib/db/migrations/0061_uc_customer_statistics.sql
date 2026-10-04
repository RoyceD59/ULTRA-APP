BEGIN;
-- Serialize concurrent startup rollouts and block customer writes during the
-- first backfill. Reads remain available; no write can slip between seed/trigger.
SELECT pg_advisory_xact_lock(738061);
LOCK TABLE uc_users IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS uc_customer_statistics (
  id integer PRIMARY KEY,
  active_count bigint NOT NULL,
  reporting_timezone text NOT NULL,
  CONSTRAINT uc_customer_statistics_singleton CHECK (id = 1),
  CONSTRAINT uc_customer_statistics_nonnegative CHECK (active_count >= 0)
);
CREATE TABLE IF NOT EXISTS uc_customer_statistics_days (
  day date PRIMARY KEY,
  active_count bigint NOT NULL,
  CONSTRAINT uc_customer_statistics_days_nonnegative CHECK (active_count >= 0)
);
-- An earlier preview may have untagged UTC buckets. Do not reinterpret their
-- dates as Kenya dates: rebuild once under the same customer-write lock.
ALTER TABLE uc_customer_statistics ADD COLUMN IF NOT EXISTS reporting_timezone text;

DO $$
BEGIN
  -- Drizzle creates empty tables in fresh databases. The singleton is the
  -- transactional initialization marker; restarts never recount all customers.
  IF NOT EXISTS (SELECT 1 FROM uc_customer_statistics
                 WHERE id = 1 AND reporting_timezone = 'Africa/Nairobi') THEN
    DELETE FROM uc_customer_statistics_days;
    INSERT INTO uc_customer_statistics_days (day, active_count)
      SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date, count(*)
      FROM uc_users WHERE deleted_at IS NULL
      GROUP BY (created_at AT TIME ZONE 'Africa/Nairobi')::date;
    INSERT INTO uc_customer_statistics (id, active_count, reporting_timezone)
      SELECT 1, coalesce(sum(active_count), 0), 'Africa/Nairobi' FROM uc_customer_statistics_days
      ON CONFLICT (id) DO UPDATE SET active_count = EXCLUDED.active_count,
        reporting_timezone = EXCLUDED.reporting_timezone;
  END IF;
END $$;
ALTER TABLE uc_customer_statistics ALTER COLUMN reporting_timezone SET NOT NULL;

CREATE OR REPLACE FUNCTION uc_maintain_customer_statistics()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  old_day date;
  new_day date;
  delta integer;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.deleted_at IS NULL THEN
    old_day := (OLD.created_at AT TIME ZONE 'Africa/Nairobi')::date;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL THEN
    new_day := (NEW.created_at AT TIME ZONE 'Africa/Nairobi')::date;
  END IF;
  IF old_day IS NOT DISTINCT FROM new_day THEN
    RETURN NULL; -- Ordinary profile edits, repeated deletion/restoration.
  END IF;
  delta := (CASE WHEN new_day IS NULL THEN 0 ELSE 1 END)
         - (CASE WHEN old_day IS NULL THEN 0 ELSE 1 END);
  -- Always lock the singleton first, even for date-only changes. This gives
  -- all writers the same lock order and protects increments from lost updates.
  UPDATE uc_customer_statistics SET active_count = active_count + delta WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer statistics not initialized';
  END IF;
  IF old_day IS NOT NULL THEN
    UPDATE uc_customer_statistics_days SET active_count = active_count - 1 WHERE day = old_day;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer statistics bucket missing';
    END IF;
    DELETE FROM uc_customer_statistics_days WHERE day = old_day AND active_count = 0;
  END IF;
  IF new_day IS NOT NULL THEN
    INSERT INTO uc_customer_statistics_days (day, active_count) VALUES (new_day, 1)
      ON CONFLICT (day) DO UPDATE
        SET active_count = uc_customer_statistics_days.active_count + 1;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS uc_customer_statistics_write ON uc_users;
CREATE TRIGGER uc_customer_statistics_write
  AFTER INSERT OR UPDATE OR DELETE ON uc_users
  FOR EACH ROW EXECUTE FUNCTION uc_maintain_customer_statistics();

CREATE OR REPLACE FUNCTION uc_reset_customer_statistics()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE uc_customer_statistics SET active_count = 0 WHERE id = 1;
  DELETE FROM uc_customer_statistics_days;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS uc_customer_statistics_truncate ON uc_users;
CREATE TRIGGER uc_customer_statistics_truncate AFTER TRUNCATE ON uc_users
  FOR EACH STATEMENT EXECUTE FUNCTION uc_reset_customer_statistics();
COMMIT;