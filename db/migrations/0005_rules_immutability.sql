-- Published rule versions are immutable: rules may only be added, changed or
-- removed while their version is a draft. Evaluations reference exact versions,
-- so this keeps every past decision explainable.
CREATE OR REPLACE FUNCTION rules_only_in_draft() RETURNS trigger AS $$
DECLARE
  v_status rule_set_status;
BEGIN
  SELECT status INTO v_status FROM rule_versions
   WHERE id = COALESCE(NEW.rule_version_id, OLD.rule_version_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'rules of a % rule version cannot be modified', v_status;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.rule_version_id <> OLD.rule_version_id THEN
    RAISE EXCEPTION 'rules cannot move between versions';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER rules_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON rules
  FOR EACH ROW EXECUTE FUNCTION rules_only_in_draft();
--> statement-breakpoint
-- Version lifecycle is one-way: draft -> active -> retired.
CREATE OR REPLACE FUNCTION rule_version_lifecycle() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'only draft rule versions can be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'active')
    OR (OLD.status = 'active' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION 'invalid rule version transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.version <> OLD.version OR NEW.rule_set_id <> OLD.rule_set_id) THEN
    RAISE EXCEPTION 'published rule versions cannot be renumbered or moved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER rule_versions_lifecycle
  BEFORE UPDATE OR DELETE ON rule_versions
  FOR EACH ROW EXECUTE FUNCTION rule_version_lifecycle();
--> statement-breakpoint
CREATE TRIGGER rule_evaluations_immutable
  BEFORE UPDATE OR DELETE ON rule_evaluations
  FOR EACH ROW EXECUTE FUNCTION history_immutable();
