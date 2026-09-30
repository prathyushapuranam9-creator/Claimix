CREATE TYPE "public"."claim_status" AS ENUM('draft', 'submitted', 'pending', 'query', 'approved', 'partially_approved', 'rejected', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('cashless', 'reimbursement');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('patient', 'medical', 'hospital', 'final_claim');--> statement-breakpoint
CREATE TYPE "public"."document_scan_status" AS ENUM('pending', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('missing', 'uploaded', 'verified', 'rejected', 'requires_reupload');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('female', 'male', 'other', 'undisclosed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."network_status" AS ENUM('network', 'non_network', 'empanelled', 'suspended', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('platform', 'hospital', 'insurer', 'tpa');--> statement-breakpoint
CREATE TYPE "public"."payer_decision" AS ENUM('approved', 'partially_approved', 'rejected', 'query', 'pending');--> statement-breakpoint
CREATE TYPE "public"."permission_scope" AS ENUM('own', 'organization', 'all');--> statement-breakpoint
CREATE TYPE "public"."policy_category" AS ENUM('private', 'government');--> statement-breakpoint
CREATE TYPE "public"."preauth_status" AS ENUM('draft', 'submitted', 'pending', 'query', 'approved', 'partially_approved', 'rejected', 'cancelled', 'final_approved', 'settled');--> statement-breakpoint
CREATE TYPE "public"."query_status" AS ENUM('open', 'responded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."rule_category" AS ENUM('eligibility', 'coverage', 'waiting_period', 'ped', 'exclusion', 'limit', 'document', 'preauth', 'claim');--> statement-breakpoint
CREATE TYPE "public"."rule_result" AS ENUM('PASS', 'FAIL', 'NEEDS_VERIFICATION');--> statement-breakpoint
CREATE TYPE "public"."rule_set_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'processing', 'paid', 'failed');--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "org_type" NOT NULL,
	"name" varchar(200) NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"description" text,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"scope" "permission_scope" NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"org_type" "org_type",
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"session_version" integer NOT NULL,
	"ip_address" "inet",
	"user_agent" varchar(400),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"session_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "government_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(200) NOT NULL,
	"authority" varchar(200) NOT NULL,
	"description" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "government_schemes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "hospital_networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"insurer_id" uuid,
	"tpa_id" uuid,
	"scheme_id" uuid,
	"status" "network_status" DEFAULT 'unverified' NOT NULL,
	"cashless_available" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospitals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"registration_no" varchar(100),
	"city" varchar(100) NOT NULL,
	"state" varchar(100) NOT NULL,
	"address" text,
	"departments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phone" varchar(30),
	"email" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "insurers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"claims_phone" varchar(30),
	"claims_email" varchar(320),
	"website" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "insurers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"user_id" uuid,
	"patient_no" varchar(40) NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"dob" date NOT NULL,
	"gender" "gender" DEFAULT 'undisclosed' NOT NULL,
	"phone" varchar(30),
	"email" varchar(320),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "patients_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "tpas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"phone" varchar(30),
	"email" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tpas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"category" "policy_category" NOT NULL,
	"policy_id" uuid,
	"scheme_id" uuid,
	"member_id" varchar(80) NOT NULL,
	"relationship" varchar(40) DEFAULT 'self' NOT NULL,
	"cover_start" date NOT NULL,
	"cover_end" date NOT NULL,
	"sum_insured_available" numeric(14, 2),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "beneficiaries_dates_chk" CHECK ("beneficiaries"."cover_end" >= "beneficiaries"."cover_start")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "policy_category" NOT NULL,
	"insurer_id" uuid,
	"tpa_id" uuid,
	"scheme_id" uuid,
	"name" varchar(200) NOT NULL,
	"product_type" varchar(60) NOT NULL,
	"sum_insured_min" numeric(14, 2),
	"sum_insured_max" numeric(14, 2),
	"summary" text,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "policies_payer_chk" CHECK (("policies"."category" = 'private' AND "policies"."insurer_id" IS NOT NULL AND "policies"."scheme_id" IS NULL) OR ("policies"."category" = 'government' AND "policies"."scheme_id" IS NOT NULL AND "policies"."insurer_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "rule_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"subject_type" varchar(40) NOT NULL,
	"subject_id" uuid,
	"overall_result" "rule_result" NOT NULL,
	"results" jsonb NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "rule_set_status" DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"category" "rule_category" NOT NULL,
	"code" varchar(80) NOT NULL,
	"title" varchar(200) NOT NULL,
	"config" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(40) NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"hospital_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"insurer_id" uuid,
	"tpa_id" uuid,
	"scheme_id" uuid,
	"pre_auth_id" uuid,
	"status" "claim_status" DEFAULT 'draft' NOT NULL,
	"diagnosis_id" uuid,
	"procedure_id" uuid,
	"admission_date" date,
	"discharge_date" date,
	"claimed_amount" numeric(14, 2),
	"approved_amount" numeric(14, 2),
	"patient_amount" numeric(14, 2),
	"created_by" uuid NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_reference_unique" UNIQUE("reference"),
	CONSTRAINT "claims_dates_chk" CHECK ("claims"."discharge_date" IS NULL OR "claims"."admission_date" IS NULL OR "claims"."discharge_date" >= "claims"."admission_date"),
	CONSTRAINT "claims_amounts_chk" CHECK (("claims"."claimed_amount" IS NULL OR "claims"."claimed_amount" >= 0) AND ("claims"."approved_amount" IS NULL OR "claims"."approved_amount" >= 0))
);
--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(250) NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "diagnoses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid,
	"scheme_id" uuid,
	"procedure_id" uuid,
	"code" varchar(40) NOT NULL,
	"name" varchar(250) NOT NULL,
	"rate" numeric(14, 2),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payer_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"decision" "payer_decision" NOT NULL,
	"approved_amount" numeric(14, 2),
	"rejection_reason_id" uuid,
	"remarks" text,
	"payer_reference" varchar(100),
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pre_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(40) NOT NULL,
	"hospital_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"insurer_id" uuid,
	"tpa_id" uuid,
	"scheme_id" uuid,
	"status" "preauth_status" DEFAULT 'draft' NOT NULL,
	"diagnosis_id" uuid,
	"procedure_id" uuid,
	"package_id" uuid,
	"clinical" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expected_admission" date,
	"expected_stay_days" integer,
	"room_category" varchar(60),
	"estimated_cost" numeric(14, 2),
	"expected_insurance_amount" numeric(14, 2),
	"approved_amount" numeric(14, 2),
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_authorizations_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(250) NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "procedures_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" "query_status" DEFAULT 'open' NOT NULL,
	"reason_id" uuid,
	"message" text NOT NULL,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raised_by" uuid NOT NULL,
	"response_message" text,
	"responded_by" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejection_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"meaning" text NOT NULL,
	"what_to_check" text NOT NULL,
	"required_action" text NOT NULL,
	"kind" varchar(20) DEFAULT 'both' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rejection_reasons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"status" "settlement_status" DEFAULT 'pending' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"utr" varchar(60),
	"settled_at" timestamp with time zone,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_amount_chk" CHECK ("settlements"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30) NOT NULL,
	"reason" text,
	"message" text,
	"required_action" text,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"responsible_team" varchar(100),
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" varchar(20),
	"subject_id" uuid,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"source" varchar(20) DEFAULT 'rules' NOT NULL,
	"needs_human_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"organization_id" uuid,
	"action" varchar(80) NOT NULL,
	"resource_type" varchar(40),
	"resource_id" varchar(64),
	"previous_state" jsonb,
	"new_state" jsonb,
	"ip_address" "inet",
	"user_agent" varchar(400),
	"session_id" uuid,
	"request_id" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"subject_type" varchar(20),
	"subject_id" uuid,
	"category" "document_category" NOT NULL,
	"doc_type" varchar(60) NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"scan_status" "document_scan_status" DEFAULT 'pending' NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"status_note" text,
	"uploaded_by" uuid NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(60) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"resource_type" varchar(30),
	"resource_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_networks" ADD CONSTRAINT "hospital_networks_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_networks" ADD CONSTRAINT "hospital_networks_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_networks" ADD CONSTRAINT "hospital_networks_tpa_id_tpas_id_fk" FOREIGN KEY ("tpa_id") REFERENCES "public"."tpas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_networks" ADD CONSTRAINT "hospital_networks_scheme_id_government_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."government_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_id_organizations_id_fk" FOREIGN KEY ("id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurers" ADD CONSTRAINT "insurers_id_organizations_id_fk" FOREIGN KEY ("id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpas" ADD CONSTRAINT "tpas_id_organizations_id_fk" FOREIGN KEY ("id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_scheme_id_government_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."government_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_tpa_id_tpas_id_fk" FOREIGN KEY ("tpa_id") REFERENCES "public"."tpas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_scheme_id_government_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."government_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_rule_version_id_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_rule_version_id_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_tpa_id_tpas_id_fk" FOREIGN KEY ("tpa_id") REFERENCES "public"."tpas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_scheme_id_government_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."government_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_pre_auth_id_pre_authorizations_id_fk" FOREIGN KEY ("pre_auth_id") REFERENCES "public"."pre_authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_scheme_id_government_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."government_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_responses" ADD CONSTRAINT "payer_responses_rejection_reason_id_rejection_reasons_id_fk" FOREIGN KEY ("rejection_reason_id") REFERENCES "public"."rejection_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_responses" ADD CONSTRAINT "payer_responses_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_tpa_id_tpas_id_fk" FOREIGN KEY ("tpa_id") REFERENCES "public"."tpas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_scheme_id_government_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."government_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_authorizations" ADD CONSTRAINT "pre_authorizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queries" ADD CONSTRAINT "queries_reason_id_rejection_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."rejection_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queries" ADD CONSTRAINT "queries_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queries" ADD CONSTRAINT "queries_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_interactions" ADD CONSTRAINT "assistant_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_interactions" ADD CONSTRAINT "assistant_interactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email_hash","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "organizations_type_idx" ON "organizations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "prt_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hospital_networks_hospital_idx" ON "hospital_networks" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "hospital_networks_insurer_idx" ON "hospital_networks" USING btree ("insurer_id");--> statement-breakpoint
CREATE INDEX "hospital_networks_scheme_idx" ON "hospital_networks" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "hospitals_city_idx" ON "hospitals" USING btree ("state","city");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_hospital_no_uq" ON "patients" USING btree ("hospital_id","patient_no");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "patients" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "beneficiaries_patient_idx" ON "beneficiaries" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "beneficiaries_member_uq" ON "beneficiaries" USING btree ("category","member_id");--> statement-breakpoint
CREATE INDEX "policies_insurer_idx" ON "policies" USING btree ("insurer_id");--> statement-breakpoint
CREATE INDEX "rule_evals_org_idx" ON "rule_evaluations" USING btree ("organization_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "rule_evals_subject_idx" ON "rule_evaluations" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_policy_name_uq" ON "rule_sets" USING btree ("policy_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_set_version_uq" ON "rule_versions" USING btree ("rule_set_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_one_active_uq" ON "rule_versions" USING btree ("rule_set_id") WHERE "rule_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "rules_version_code_uq" ON "rules" USING btree ("rule_version_id","code");--> statement-breakpoint
CREATE INDEX "claims_hospital_status_idx" ON "claims" USING btree ("hospital_id","status");--> statement-breakpoint
CREATE INDEX "claims_insurer_status_idx" ON "claims" USING btree ("insurer_id","status");--> statement-breakpoint
CREATE INDEX "claims_tpa_idx" ON "claims" USING btree ("tpa_id");--> statement-breakpoint
CREATE INDEX "claims_patient_idx" ON "claims" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "claims_updated_idx" ON "claims" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "packages_policy_idx" ON "packages" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "payer_responses_subject_idx" ON "payer_responses" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "preauth_hospital_status_idx" ON "pre_authorizations" USING btree ("hospital_id","status");--> statement-breakpoint
CREATE INDEX "preauth_insurer_status_idx" ON "pre_authorizations" USING btree ("insurer_id","status");--> statement-breakpoint
CREATE INDEX "preauth_tpa_idx" ON "pre_authorizations" USING btree ("tpa_id");--> statement-breakpoint
CREATE INDEX "preauth_patient_idx" ON "pre_authorizations" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "queries_subject_idx" ON "queries" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_claim_uq" ON "settlements" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "status_history_subject_idx" ON "status_history" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_user_idx" ON "assistant_interactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_logs" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "documents_subject_idx" ON "documents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "documents_patient_idx" ON "documents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");