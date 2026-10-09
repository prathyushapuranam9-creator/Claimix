CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'upi', 'card');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('paid', 'pending');--> statement-breakpoint
CREATE TYPE "public"."visit_type" AS ENUM('opd_consultation', 'ip_admission');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(40) NOT NULL,
	"hospital_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"department" varchar(40) NOT NULL,
	"visit_type" "visit_type" NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"consultation_fee" numeric(14, 2) NOT NULL,
	"amount_collected" numeric(14, 2),
	"payment_method" "payment_method",
	"payment_state" "payment_state" NOT NULL,
	"consent_acknowledged_at" timestamp with time zone NOT NULL,
	"consent_acknowledged_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "appointments_fee_chk" CHECK ("appointments"."consultation_fee" >= 0 AND ("appointments"."amount_collected" IS NULL OR "appointments"."amount_collected" >= 0)),
	CONSTRAINT "appointments_payment_chk" CHECK (("appointments"."payment_state" = 'paid' AND "appointments"."payment_method" IS NOT NULL AND "appointments"."amount_collected" IS NOT NULL) OR ("appointments"."payment_state" = 'pending' AND "appointments"."payment_method" IS NULL AND "appointments"."amount_collected" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "doctor_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"slot_date" date NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_slots_period_chk" CHECK ("doctor_slots"."ends_at" > "doctor_slots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"department" varchar(40) NOT NULL,
	"registration_no" varchar(60),
	"consultation_fee" numeric(14, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "doctors_fee_chk" CHECK ("doctors"."consultation_fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_doctor_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."doctor_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_consent_acknowledged_by_users_id_fk" FOREIGN KEY ("consent_acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_slots" ADD CONSTRAINT "doctor_slots_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_slot_live_uq" ON "appointments" USING btree ("slot_id") WHERE "appointments"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "appointments_hospital_status_idx" ON "appointments" USING btree ("hospital_id","status");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "appointments_doctor_day_idx" ON "appointments" USING btree ("doctor_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_slots_uq" ON "doctor_slots" USING btree ("doctor_id","slot_date","starts_at");--> statement-breakpoint
CREATE INDEX "doctor_slots_day_idx" ON "doctor_slots" USING btree ("doctor_id","slot_date");--> statement-breakpoint
CREATE INDEX "doctors_hospital_dept_idx" ON "doctors" USING btree ("hospital_id","department");--> statement-breakpoint
-- A registration is one consistent chain whatever writes it: the patient and the doctor both belong to
-- the appointment's hospital, the slot belongs to that doctor, and the recorded department is the
-- doctor's own. (The services check the same things; this is the guarantee behind them.)
CREATE OR REPLACE FUNCTION enforce_appointment_links() RETURNS trigger AS $$
DECLARE
  pat_hospital uuid;
  doc_hospital uuid;
  doc_department varchar(40);
  slot_doctor uuid;
BEGIN
  SELECT p.hospital_id INTO pat_hospital FROM patients p WHERE p.id = NEW.patient_id;
  IF pat_hospital IS DISTINCT FROM NEW.hospital_id THEN
    RAISE EXCEPTION 'patient % is registered at hospital %, not %', NEW.patient_id, pat_hospital, NEW.hospital_id;
  END IF;

  SELECT d.hospital_id, d.department INTO doc_hospital, doc_department FROM doctors d WHERE d.id = NEW.doctor_id;
  IF doc_hospital IS NULL THEN
    RAISE EXCEPTION 'doctor % does not exist', NEW.doctor_id;
  END IF;
  IF doc_hospital <> NEW.hospital_id THEN
    RAISE EXCEPTION 'doctor % practises at hospital %, not %', NEW.doctor_id, doc_hospital, NEW.hospital_id;
  END IF;
  IF doc_department <> NEW.department THEN
    RAISE EXCEPTION 'doctor % is in department %, not %', NEW.doctor_id, doc_department, NEW.department;
  END IF;

  SELECT s.doctor_id INTO slot_doctor FROM doctor_slots s WHERE s.id = NEW.slot_id;
  IF slot_doctor IS NULL THEN
    RAISE EXCEPTION 'slot % does not exist', NEW.slot_id;
  END IF;
  IF slot_doctor <> NEW.doctor_id THEN
    RAISE EXCEPTION 'slot % belongs to doctor %, not %', NEW.slot_id, slot_doctor, NEW.doctor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER appointments_links
  BEFORE INSERT OR UPDATE OF hospital_id, patient_id, doctor_id, slot_id, department ON appointments
  FOR EACH ROW EXECUTE FUNCTION enforce_appointment_links();
