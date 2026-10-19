-- Preserve the referral sensitivity history even when maintenance tools issue
-- UPDATE or DELETE directly. Inserts remain the only permitted data mutation.
CREATE OR REPLACE FUNCTION reject_referral_threshold_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'referral_alert_threshold_changes is append-only: % is not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS referral_threshold_audit_append_only ON referral_alert_threshold_changes;
CREATE TRIGGER referral_threshold_audit_append_only
  BEFORE UPDATE OR DELETE ON referral_alert_threshold_changes
  FOR EACH STATEMENT EXECUTE FUNCTION reject_referral_threshold_audit_mutation();