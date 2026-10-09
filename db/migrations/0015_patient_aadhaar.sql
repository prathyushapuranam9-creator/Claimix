ALTER TABLE "patients" ADD COLUMN "aadhaar_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "aadhaar_last4" varchar(4);--> statement-breakpoint
CREATE INDEX "patients_aadhaar_hash_idx" ON "patients" USING btree ("aadhaar_hash");--> statement-breakpoint
CREATE INDEX "patients_aadhaar_last4_idx" ON "patients" USING btree ("aadhaar_last4");