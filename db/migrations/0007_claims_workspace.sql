ALTER TABLE "claims" ADD COLUMN "bill_number" varchar(60);--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "room_rent_per_day" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "clinical" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "latest_evaluation_id" uuid;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "submit_override_reason" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "checklist" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "deduction_note" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "payee" varchar(20) DEFAULT 'hospital' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_preauth_live_uq" ON "claims" USING btree ("pre_auth_id") WHERE "claims"."pre_auth_id" IS NOT NULL AND "claims"."status" <> 'cancelled';