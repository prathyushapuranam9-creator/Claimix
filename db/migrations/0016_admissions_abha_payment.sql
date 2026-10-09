CREATE TYPE "public"."admission_status" AS ENUM('admitted', 'discharged', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."visit_type" ADD VALUE 'pre_auth';--> statement-breakpoint
CREATE TABLE "admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"hospital_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" "admission_status" DEFAULT 'admitted' NOT NULL,
	"ward" varchar(80),
	"bed" varchar(40),
	"expected_stay_days" integer,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discharged_at" timestamp with time zone,
	"discharge_note" text,
	"admitted_by" uuid NOT NULL,
	"discharged_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admissions_stay_chk" CHECK ("admissions"."expected_stay_days" IS NULL OR ("admissions"."expected_stay_days" >= 1 AND "admissions"."expected_stay_days" <= 365)),
	CONSTRAINT "admissions_discharge_chk" CHECK (("admissions"."status" = 'discharged' AND "admissions"."discharged_at" IS NOT NULL AND "admissions"."discharged_by" IS NOT NULL) OR ("admissions"."status" <> 'discharged' AND "admissions"."discharged_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_payment_chk";--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "abha_number" varchar(17);--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "abha_address" varchar(120);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_reference" varchar(40);--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_admitted_by_users_id_fk" FOREIGN KEY ("admitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_discharged_by_users_id_fk" FOREIGN KEY ("discharged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_appointment_uq" ON "admissions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "admissions_hospital_status_idx" ON "admissions" USING btree ("hospital_id","status");--> statement-breakpoint
CREATE INDEX "admissions_patient_idx" ON "admissions" USING btree ("patient_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_payment_chk" CHECK (("appointments"."payment_state" = 'paid' AND "appointments"."amount_collected" IS NOT NULL AND ("appointments"."payment_method" IS NOT NULL OR "appointments"."amount_collected" = 0)) OR ("appointments"."payment_state" = 'pending' AND "appointments"."payment_method" IS NULL AND "appointments"."amount_collected" IS NULL));--> statement-breakpoint
-- A stay belongs to its own registration: same patient, same hospital, and only for a visit that was
-- registered as an inpatient admission.
CREATE OR REPLACE FUNCTION enforce_admission_links() RETURNS trigger AS $$
DECLARE
  a_patient uuid;
  a_hospital uuid;
  a_visit text;
BEGIN
  SELECT a.patient_id, a.hospital_id, a.visit_type::text INTO a_patient, a_hospital, a_visit
    FROM appointments a WHERE a.id = NEW.appointment_id;
  IF a_patient IS NULL THEN
    RAISE EXCEPTION 'registration % does not exist', NEW.appointment_id;
  END IF;
  IF a_patient <> NEW.patient_id OR a_hospital <> NEW.hospital_id THEN
    RAISE EXCEPTION 'admission does not match registration % (patient %, hospital %)', NEW.appointment_id, a_patient, a_hospital;
  END IF;
  IF a_visit <> 'ip_admission' THEN
    RAISE EXCEPTION 'registration % is a % visit, not an inpatient admission', NEW.appointment_id, a_visit;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER admissions_links
  BEFORE INSERT OR UPDATE OF appointment_id, patient_id, hospital_id ON admissions
  FOR EACH ROW EXECUTE FUNCTION enforce_admission_links();
