ALTER TABLE "pre_authorizations" ADD COLUMN "claim_type" "claim_type" DEFAULT 'cashless' NOT NULL;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD COLUMN "room_rent_per_day" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD COLUMN "patient_contribution" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD COLUMN "latest_evaluation_id" uuid;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD COLUMN "submit_override_reason" text;