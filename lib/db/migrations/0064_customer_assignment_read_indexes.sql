-- Keep all audit events; bound read payloads instead of pruning history.
CREATE INDEX IF NOT EXISTS uc_customer_assignments_status_id_idx ON uc_customer_assignments(status,id);
CREATE INDEX IF NOT EXISTS uc_customer_assignments_account_status_id_idx ON uc_customer_assignments(linked_account_id,status,id);
CREATE INDEX IF NOT EXISTS uc_customer_assignment_audit_assignment_id_idx ON uc_customer_assignment_audit(assignment_id,id);