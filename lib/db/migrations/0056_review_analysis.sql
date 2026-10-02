ALTER TABLE uc_reviews
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS text_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS analysis json NOT NULL DEFAULT '{"status":"pending","version":1}';

CREATE OR REPLACE FUNCTION uc_review_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.author_name = '[deleted customer]' OR NEW.body = '[deleted customer]' THEN
    NEW.analysis := '{"status":"unavailable","version":1,"error":"Deleted account"}'::json;
    IF TG_OP = 'UPDATE' THEN NEW.text_revision := OLD.text_revision + 1; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body THEN
      NEW.text_revision := OLD.text_revision + 1;
      NEW.analysis := '{"status":"pending","version":1}'::json;
    END IF;
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
      OR NEW.rating IS DISTINCT FROM OLD.rating OR NEW.media::text IS DISTINCT FROM OLD.media::text THEN
      NEW.edited_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS uc_review_revision_guard ON uc_reviews;
CREATE TRIGGER uc_review_revision_guard BEFORE INSERT OR UPDATE ON uc_reviews
  FOR EACH ROW EXECUTE FUNCTION uc_review_revision_guard();
CREATE INDEX IF NOT EXISTS uc_reviews_analysis_status_idx ON uc_reviews ((analysis->>'status'), id);
-- Older deleted placeholders must not enter the historical backlog.
UPDATE uc_reviews r SET analysis='{"status":"unavailable","version":1,"error":"Deleted account"}'::json
WHERE (r.author_name='[deleted customer]' OR r.body='[deleted customer]'
  OR EXISTS(SELECT 1 FROM uc_users u WHERE u.id::text=r.user_id AND u.deleted_at IS NOT NULL))
AND (r.analysis->>'status' IS DISTINCT FROM 'unavailable'
  OR r.analysis->>'explanation' IS NOT NULL OR r.analysis->>'lease' IS NOT NULL);