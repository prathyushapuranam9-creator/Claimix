-- Database-level guarantees for payer decisions (defence in depth behind the services):
--  * a claim or pre-auth can only become "rejected" if a rejected payer response exists for it;
--  * a claim can only become "settled" if a paid settlement exists for it.
CREATE OR REPLACE FUNCTION enforce_payer_decision() RETURNS trigger AS $$
DECLARE
  subject text := CASE TG_TABLE_NAME WHEN 'claims' THEN 'claim' ELSE 'preauth' END;
BEGIN
  IF NEW.status = 'rejected' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'rejected') THEN
    IF NOT EXISTS (
      SELECT 1 FROM payer_responses r
       WHERE r.subject_type = subject AND r.subject_id = NEW.id AND r.decision = 'rejected'
    ) THEN
      RAISE EXCEPTION '% % cannot be rejected without a recorded payer rejection', subject, NEW.id;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'claims' AND NEW.status = 'settled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'settled') THEN
    IF NOT EXISTS (SELECT 1 FROM settlements s WHERE s.claim_id = NEW.id AND s.status = 'paid') THEN
      RAISE EXCEPTION 'claim % cannot be settled without a paid settlement record', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claims_payer_decision
  BEFORE INSERT OR UPDATE OF status ON claims
  FOR EACH ROW EXECUTE FUNCTION enforce_payer_decision();
--> statement-breakpoint
CREATE TRIGGER pre_authorizations_payer_decision
  BEFORE INSERT OR UPDATE OF status ON pre_authorizations
  FOR EACH ROW EXECUTE FUNCTION enforce_payer_decision();
--> statement-breakpoint
-- Recorded settlements are financial records: amounts can't be edited or rows removed.
CREATE OR REPLACE FUNCTION settlements_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'settlements cannot be deleted'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.claim_id <> OLD.claim_id THEN
    RAISE EXCEPTION 'settlement amount and claim cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER settlements_immutable_amount
  BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_guard();
