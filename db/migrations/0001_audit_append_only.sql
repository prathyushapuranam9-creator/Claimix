-- Audit logs are append-only: reject UPDATE, DELETE and TRUNCATE.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
-- Status history and payer responses are likewise an immutable record.
CREATE OR REPLACE FUNCTION history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER status_history_immutable
  BEFORE UPDATE OR DELETE ON status_history
  FOR EACH ROW EXECUTE FUNCTION history_immutable();
--> statement-breakpoint
CREATE TRIGGER payer_responses_immutable
  BEFORE UPDATE OR DELETE ON payer_responses
  FOR EACH ROW EXECUTE FUNCTION history_immutable();
