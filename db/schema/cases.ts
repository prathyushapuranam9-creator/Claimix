import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, timestamps } from "./_common";
import { claimStatus, claimType, payerDecision, preauthStatus, queryStatus, settlementStatus } from "./enums";
import { organizations, users } from "./identity";
import { beneficiaries, policies } from "./policies";
import { governmentSchemes, hospitals, insurers, patients, tpas } from "./parties";

export const diagnoses = pgTable("diagnoses", {
  id: id(),
  code: varchar("code", { length: 20 }).notNull().unique(), // ICD-10 style
  name: varchar("name", { length: 250 }).notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const procedures = pgTable("procedures", {
  id: id(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 250 }).notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const packages = pgTable("packages", {
  id: id(),
  policyId: uuid("policy_id").references(() => policies.id),
  schemeId: uuid("scheme_id").references(() => governmentSchemes.id),
  procedureId: uuid("procedure_id").references(() => procedures.id),
  code: varchar("code", { length: 40 }).notNull(),
  name: varchar("name", { length: 250 }).notNull(),
  rate: numeric("rate", { precision: 14, scale: 2 }),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [index("packages_policy_idx").on(t.policyId)]);

export const rejectionReasons = pgTable("rejection_reasons", {
  id: id(),
  code: varchar("code", { length: 60 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  meaning: text("meaning").notNull(),
  whatToCheck: text("what_to_check").notNull(),
  requiredAction: text("required_action").notNull(),
  kind: varchar("kind", { length: 20 }).notNull().default("both"), // query | rejection | both
  ...timestamps,
});

export const preAuthorizations = pgTable("pre_authorizations", {
  id: id(),
  reference: varchar("reference", { length: 40 }).notNull().unique(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id),
  policyId: uuid("policy_id").notNull().references(() => policies.id),
  insurerId: uuid("insurer_id").references(() => insurers.id),
  tpaId: uuid("tpa_id").references(() => tpas.id),
  schemeId: uuid("scheme_id").references(() => governmentSchemes.id),
  status: preauthStatus("status").notNull().default("draft"),
  diagnosisId: uuid("diagnosis_id").references(() => diagnoses.id),
  procedureId: uuid("procedure_id").references(() => procedures.id),
  packageId: uuid("package_id").references(() => packages.id),
  clinical: jsonb("clinical").$type<Record<string, unknown>>().notNull().default({}),
  expectedAdmission: date("expected_admission"),
  expectedStayDays: integer("expected_stay_days"),
  claimType: claimType("claim_type").notNull().default("cashless"),
  roomCategory: varchar("room_category", { length: 60 }),
  roomRentPerDay: numeric("room_rent_per_day", { precision: 14, scale: 2 }),
  estimatedCost: numeric("estimated_cost", { precision: 14, scale: 2 }),
  expectedInsuranceAmount: numeric("expected_insurance_amount", { precision: 14, scale: 2 }),
  patientContribution: numeric("patient_contribution", { precision: 14, scale: 2 }),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }),
  latestEvaluationId: uuid("latest_evaluation_id"),
  // Set only when a hospital submits despite failed checks; the reason is audited.
  submitOverrideReason: text("submit_override_reason"),
  // Manual confirmations / human-verification notes per checklist item.
  checklist: jsonb("checklist").$type<Record<string, { confirmed: boolean; note?: string; by: string; at: string }>>().notNull().default({}),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  // Set when an insurer / TPA reviewer raised this request on the hospital's behalf (New Claim wizard); null = the hospital raised it.
  raisedByOrgId: uuid("raised_by_org_id").references(() => organizations.id),
  isDemo: boolean("is_demo").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("preauth_hospital_status_idx").on(t.hospitalId, t.status),
  index("preauth_insurer_status_idx").on(t.insurerId, t.status),
  index("preauth_tpa_idx").on(t.tpaId),
  index("preauth_patient_idx").on(t.patientId),
]);

export const claims = pgTable("claims", {
  id: id(),
  reference: varchar("reference", { length: 40 }).notNull().unique(),
  claimType: claimType("claim_type").notNull(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id),
  policyId: uuid("policy_id").notNull().references(() => policies.id),
  insurerId: uuid("insurer_id").references(() => insurers.id),
  tpaId: uuid("tpa_id").references(() => tpas.id),
  schemeId: uuid("scheme_id").references(() => governmentSchemes.id),
  preAuthId: uuid("pre_auth_id").references(() => preAuthorizations.id),
  status: claimStatus("status").notNull().default("draft"),
  diagnosisId: uuid("diagnosis_id").references(() => diagnoses.id),
  procedureId: uuid("procedure_id").references(() => procedures.id),
  admissionDate: date("admission_date"),
  dischargeDate: date("discharge_date"),
  billNumber: varchar("bill_number", { length: 60 }),
  roomRentPerDay: numeric("room_rent_per_day", { precision: 14, scale: 2 }),
  claimedAmount: numeric("claimed_amount", { precision: 14, scale: 2 }),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }),
  patientAmount: numeric("patient_amount", { precision: 14, scale: 2 }),
  // Final clinical details and free-text notes (final diagnosis, treatment given).
  clinical: jsonb("clinical").$type<Record<string, unknown>>().notNull().default({}),
  latestEvaluationId: uuid("latest_evaluation_id"),
  submitOverrideReason: text("submit_override_reason"),
  checklist: jsonb("checklist").$type<Record<string, { confirmed: boolean; note?: string; by: string; at: string }>>().notNull().default({}),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  // One live claim per pre-authorization.
  uniqueIndex("claims_preauth_live_uq").on(t.preAuthId).where(sql`${t.preAuthId} IS NOT NULL AND ${t.status} <> 'cancelled'`),
  index("claims_hospital_status_idx").on(t.hospitalId, t.status),
  index("claims_insurer_status_idx").on(t.insurerId, t.status),
  index("claims_tpa_idx").on(t.tpaId),
  index("claims_patient_idx").on(t.patientId),
  index("claims_updated_idx").on(t.updatedAt),
  check("claims_dates_chk", sql`${t.dischargeDate} IS NULL OR ${t.admissionDate} IS NULL OR ${t.dischargeDate} >= ${t.admissionDate}`),
  check("claims_amounts_chk", sql`(${t.claimedAmount} IS NULL OR ${t.claimedAmount} >= 0) AND (${t.approvedAmount} IS NULL OR ${t.approvedAmount} >= 0)`),
]);

// Timeline: one row per status change, for both pre-auths and claims.
export const statusHistory = pgTable("status_history", {
  id: id(),
  subjectType: varchar("subject_type", { length: 20 }).notNull(), // preauth | claim
  subjectId: uuid("subject_id").notNull(),
  fromStatus: varchar("from_status", { length: 30 }),
  toStatus: varchar("to_status", { length: 30 }).notNull(),
  reason: text("reason"),
  message: text("message"),
  requiredAction: text("required_action"),
  requiredDocuments: jsonb("required_documents").$type<string[]>().notNull().default([]),
  responsibleTeam: varchar("responsible_team", { length: 100 }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("status_history_subject_idx").on(t.subjectType, t.subjectId, t.createdAt)]);

// The recorded payer (insurer/TPA/scheme) response. A claim may only be marked
// rejected when a matching rejected payer response exists.
export const payerResponses = pgTable("payer_responses", {
  id: id(),
  subjectType: varchar("subject_type", { length: 20 }).notNull(), // preauth | claim
  subjectId: uuid("subject_id").notNull(),
  decision: payerDecision("decision").notNull(),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }),
  rejectionReasonId: uuid("rejection_reason_id").references(() => rejectionReasons.id),
  remarks: text("remarks"),
  payerReference: varchar("payer_reference", { length: 100 }),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("payer_responses_subject_idx").on(t.subjectType, t.subjectId)]);

export const queries = pgTable("queries", {
  id: id(),
  subjectType: varchar("subject_type", { length: 20 }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  status: queryStatus("status").notNull().default("open"),
  reasonId: uuid("reason_id").references(() => rejectionReasons.id),
  message: text("message").notNull(),
  requiredDocuments: jsonb("required_documents").$type<string[]>().notNull().default([]),
  raisedBy: uuid("raised_by").notNull().references(() => users.id),
  responseMessage: text("response_message"),
  respondedBy: uuid("responded_by").references(() => users.id),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [index("queries_subject_idx").on(t.subjectType, t.subjectId)]);

export const settlements = pgTable("settlements", {
  id: id(),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  status: settlementStatus("status").notNull().default("pending"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  utr: varchar("utr", { length: 60 }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  deductionNote: text("deduction_note"),
  payee: varchar("payee", { length: 20 }).notNull().default("hospital"), // hospital (cashless) | patient (reimbursement)
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  ...timestamps,
}, (t) => [
  uniqueIndex("settlements_claim_uq").on(t.claimId),
  check("settlements_amount_chk", sql`${t.amount} >= 0`),
]);
