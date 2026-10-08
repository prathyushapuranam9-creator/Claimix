CREATE TYPE "public"."coverage_verification" AS ENUM('verified', 'requires_verification');--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "verification_status" "coverage_verification" DEFAULT 'requires_verification' NOT NULL;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Coverage recorded before verification tracking existed was entered from the card or scheme record
-- by hospital staff, so it keeps counting as verified; only new coverage starts unverified.
UPDATE "beneficiaries" SET "verification_status" = 'verified';
--> statement-breakpoint
-- An insurance document may only be cited as the source of coverage for its OWN patient, and only
-- coverage-stage documents (no pre-auth / claim subject) are coverage evidence.
CREATE OR REPLACE FUNCTION enforce_coverage_source_document() RETURNS trigger AS $$
BEGIN
  IF NEW.source_document_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM documents d
     WHERE d.id = NEW.source_document_id AND d.patient_id = NEW.patient_id AND d.subject_id IS NULL AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'coverage source document % does not belong to patient %', NEW.source_document_id, NEW.patient_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER beneficiaries_source_document
  BEFORE INSERT OR UPDATE OF source_document_id, patient_id ON beneficiaries
  FOR EACH ROW EXECUTE FUNCTION enforce_coverage_source_document();
--> statement-breakpoint
-- Patient → coverage → policy → hospital must stay one consistent chain on every request, whatever
-- wrote the row: a pre-auth or claim can never carry another patient's coverage, a policy the
-- coverage isn't under, or a patient another hospital registered.
CREATE OR REPLACE FUNCTION enforce_case_links() RETURNS trigger AS $$
DECLARE
  cov_patient uuid;
  cov_policy uuid;
  pat_hospital uuid;
BEGIN
  SELECT b.patient_id, b.policy_id INTO cov_patient, cov_policy FROM beneficiaries b WHERE b.id = NEW.beneficiary_id;
  IF cov_patient IS NULL THEN
    RAISE EXCEPTION 'coverage % does not exist', NEW.beneficiary_id;
  END IF;
  IF cov_patient <> NEW.patient_id THEN
    RAISE EXCEPTION 'coverage % belongs to patient %, not %', NEW.beneficiary_id, cov_patient, NEW.patient_id;
  END IF;
  IF cov_policy IS NOT NULL AND cov_policy <> NEW.policy_id THEN
    RAISE EXCEPTION 'coverage % is under policy %, not %', NEW.beneficiary_id, cov_policy, NEW.policy_id;
  END IF;
  SELECT p.hospital_id INTO pat_hospital FROM patients p WHERE p.id = NEW.patient_id;
  IF pat_hospital IS DISTINCT FROM NEW.hospital_id THEN
    RAISE EXCEPTION 'patient % is registered at hospital %, not %', NEW.patient_id, pat_hospital, NEW.hospital_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pre_authorizations_case_links
  BEFORE INSERT OR UPDATE OF patient_id, beneficiary_id, policy_id, hospital_id ON pre_authorizations
  FOR EACH ROW EXECUTE FUNCTION enforce_case_links();
--> statement-breakpoint
CREATE TRIGGER claims_case_links
  BEFORE INSERT OR UPDATE OF patient_id, beneficiary_id, policy_id, hospital_id ON claims
  FOR EACH ROW EXECUTE FUNCTION enforce_case_links();
--> statement-breakpoint
-- A document filed against a pre-auth or claim must be that same patient's document.
CREATE OR REPLACE FUNCTION enforce_document_subject_patient() RETURNS trigger AS $$
DECLARE
  subject_patient uuid;
BEGIN
  IF NEW.subject_id IS NULL OR NEW.subject_type IS NULL THEN RETURN NEW; END IF;
  IF NEW.subject_type = 'preauth' THEN
    SELECT p.patient_id INTO subject_patient FROM pre_authorizations p WHERE p.id = NEW.subject_id;
  ELSIF NEW.subject_type = 'claim' THEN
    SELECT c.patient_id INTO subject_patient FROM claims c WHERE c.id = NEW.subject_id;
  ELSE
    RAISE EXCEPTION 'unknown document subject type %', NEW.subject_type;
  END IF;
  IF subject_patient IS DISTINCT FROM NEW.patient_id THEN
    RAISE EXCEPTION 'document for patient % cannot be filed against % % (patient %)', NEW.patient_id, NEW.subject_type, NEW.subject_id, subject_patient;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER documents_subject_patient
  BEFORE INSERT OR UPDATE OF patient_id, subject_type, subject_id ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_document_subject_patient();
