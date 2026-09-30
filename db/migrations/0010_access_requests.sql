CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"email" varchar(320) NOT NULL,
	"organization_name" varchar(200) NOT NULL,
	"organization_type" varchar(20) NOT NULL,
	"job_title" varchar(100),
	"phone" varchar(30),
	"message" text,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_email_lower_chk" CHECK ("access_requests"."email" = lower("access_requests"."email")),
	CONSTRAINT "access_requests_org_type_chk" CHECK ("access_requests"."organization_type" in ('hospital', 'insurer', 'tpa', 'scheme_desk', 'other'))
);
--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "access_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "access_requests_ip_idx" ON "access_requests" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "access_requests_email_idx" ON "access_requests" USING btree ("email");