import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, softDelete, timestamps } from "./_common";
import { coverageVerification, policyCategory, ruleCategory, ruleResult, ruleSetStatus } from "./enums";
import { organizations, users } from "./identity";
import { documents } from "./ops";
import { governmentSchemes, insurers, patients, tpas } from "./parties";

export const policies = pgTable("policies", {
  id: id(),
  category: policyCategory("category").notNull(),
  insurerId: uuid("insurer_id").references(() => insurers.id),
  tpaId: uuid("tpa_id").references(() => tpas.id),
  schemeId: uuid("scheme_id").references(() => governmentSchemes.id),
  name: varchar("name", { length: 200 }).notNull(),
  productType: varchar("product_type", { length: 60 }).notNull(), // e.g. family_floater, top_up
  sumInsuredMin: numeric("sum_insured_min", { precision: 14, scale: 2 }),
  sumInsuredMax: numeric("sum_insured_max", { precision: 14, scale: 2 }),
  summary: text("summary"),
  // Descriptive, non-decisional content shown on policy tabs (contact, renewal, claim process...).
  info: jsonb("info").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
  ...softDelete,
}, (t) => [
  index("policies_insurer_idx").on(t.insurerId),
  check(
    "policies_payer_chk",
    sql`(${t.category} = 'private' AND ${t.insurerId} IS NOT NULL AND ${t.schemeId} IS NULL) OR (${t.category} = 'government' AND ${t.schemeId} IS NOT NULL AND ${t.insurerId} IS NULL)`,
  ),
]);

// A patient's cover: a private policy or a government scheme enrolment.
export const beneficiaries = pgTable("beneficiaries", {
  id: id(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  category: policyCategory("category").notNull(),
  policyId: uuid("policy_id").references(() => policies.id),
  schemeId: uuid("scheme_id").references(() => governmentSchemes.id),
  memberId: varchar("member_id", { length: 80 }).notNull(),
  relationship: varchar("relationship", { length: 40 }).notNull().default("self"),
  coverStart: date("cover_start").notNull(),
  coverEnd: date("cover_end").notNull(),
  // First inception date with continuous renewals: waiting periods run from here.
  inceptionDate: date("inception_date"),
  sumInsured: numeric("sum_insured", { precision: 14, scale: 2 }),
  sumInsuredAvailable: numeric("sum_insured_available", { precision: 14, scale: 2 }),
  /**
   * Whether the recorded details were checked against the insurance card / policy document.
   * Coverage entered before the document is available stays "requires_verification"; it does not
   * block eligibility checks or requests, it only tells staff the record is still unconfirmed.
   */
  verificationStatus: coverageVerification("verification_status").notNull().default("requires_verification"),
  /** The patient-level insurance document the details were taken from (null: entered manually). */
  sourceDocumentId: uuid("source_document_id").references(() => documents.id),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
  ...softDelete,
}, (t) => [
  index("beneficiaries_patient_idx").on(t.patientId),
  uniqueIndex("beneficiaries_member_uq").on(t.category, t.memberId),
  check("beneficiaries_dates_chk", sql`${t.coverEnd} >= ${t.coverStart}`),
]);

export const ruleSets = pgTable("rule_sets", {
  id: id(),
  policyId: uuid("policy_id").notNull().references(() => policies.id),
  name: varchar("name", { length: 200 }).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("rule_sets_policy_name_uq").on(t.policyId, t.name)]);

export const ruleVersions = pgTable("rule_versions", {
  id: id(),
  ruleSetId: uuid("rule_set_id").notNull().references(() => ruleSets.id),
  version: integer("version").notNull(),
  status: ruleSetStatus("status").notNull().default("draft"),
  effectiveFrom: date("effective_from"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
}, (t) => [
  uniqueIndex("rule_versions_set_version_uq").on(t.ruleSetId, t.version),
  // At most one active version per rule set.
  uniqueIndex("rule_versions_one_active_uq").on(t.ruleSetId).where(sql`${t.status} = 'active'`),
]);

export const rules = pgTable("rules", {
  id: id(),
  ruleVersionId: uuid("rule_version_id").notNull().references(() => ruleVersions.id),
  category: ruleCategory("category").notNull(),
  code: varchar("code", { length: 80 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  // Declarative rule definition interpreted by the rules engine (no code stored).
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => [uniqueIndex("rules_version_code_uq").on(t.ruleVersionId, t.code)]);

export const ruleEvaluations = pgTable("rule_evaluations", {
  id: id(),
  policyId: uuid("policy_id").notNull().references(() => policies.id),
  ruleSetId: uuid("rule_set_id").notNull().references(() => ruleSets.id),
  ruleVersionId: uuid("rule_version_id").notNull().references(() => ruleVersions.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id), // tenant that ran it
  actorUserId: uuid("actor_user_id").references(() => users.id), // null = system
  subjectType: varchar("subject_type", { length: 40 }).notNull(), // eligibility_check | preauth | claim
  subjectId: uuid("subject_id"),
  overallResult: ruleResult("overall_result").notNull(),
  results: jsonb("results").$type<unknown[]>().notNull(), // per-rule outcome + reason
  missingInformation: jsonb("missing_information").$type<string[]>().notNull().default([]),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("rule_evals_org_idx").on(t.organizationId, t.evaluatedAt),
  index("rule_evals_subject_idx").on(t.subjectType, t.subjectId),
]);
