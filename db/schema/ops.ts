import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, inet, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { accessRequestStatus, documentCategory, documentScanStatus, documentStatus, jobStatus, reviewStatus } from "./enums";
import { organizations, users } from "./identity";
import { patients } from "./parties";

export const documents = pgTable("documents", {
  id: id(),
  // Owning tenant (the hospital that uploaded). Used for scoping downloads.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  subjectType: varchar("subject_type", { length: 20 }), // preauth | claim | null (patient-level)
  subjectId: uuid("subject_id"),
  category: documentCategory("category").notNull(),
  docType: varchar("doc_type", { length: 60 }).notNull(), // e.g. id_proof, discharge_summary
  status: documentStatus("status").notNull().default("uploaded"),
  scanStatus: documentScanStatus("scan_status").notNull().default("pending"),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  // Generated key only; never derived from user input. Files are never publicly addressable.
  storageKey: varchar("storage_key", { length: 200 }).notNull().unique(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  statusNote: text("status_note"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("documents_subject_idx").on(t.subjectType, t.subjectId),
  index("documents_patient_idx").on(t.patientId),
  index("documents_org_idx").on(t.organizationId),
]);

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  kind: varchar("kind", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body"),
  resourceType: varchar("resource_type", { length: 30 }),
  resourceId: uuid("resource_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)]);

// Append-only: an SQL trigger (see migrations) rejects UPDATE and DELETE.
export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid("actor_user_id"), // no FK: audit rows must outlive users
  organizationId: uuid("organization_id"),
  action: varchar("action", { length: 80 }).notNull(),
  resourceType: varchar("resource_type", { length: 40 }),
  resourceId: varchar("resource_id", { length: 64 }),
  previousState: jsonb("previous_state").$type<Record<string, unknown>>(),
  newState: jsonb("new_state").$type<Record<string, unknown>>(),
  ipAddress: inet("ip_address"),
  userAgent: varchar("user_agent", { length: 400 }),
  sessionId: uuid("session_id"),
  requestId: varchar("request_id", { length: 64 }),
}, (t) => [
  index("audit_org_time_idx").on(t.organizationId, t.occurredAt),
  index("audit_resource_idx").on(t.resourceType, t.resourceId),
  index("audit_actor_idx").on(t.actorUserId, t.occurredAt),
]);

// Simple DB-backed job queue behind the JobQueue abstraction (email, scans, exports...).
export const jobs = pgTable("jobs", {
  id: id(),
  type: varchar("type", { length: 60 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: jobStatus("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  ...timestamps,
}, (t) => [index("jobs_pick_idx").on(t.status, t.runAt)]);

export const assistantInteractions = pgTable("assistant_interactions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  subjectType: varchar("subject_type", { length: 20 }),
  subjectId: uuid("subject_id"),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  source: varchar("source", { length: 20 }).notNull().default("rules"), // rules | llm
  needsHumanReview: boolean("needs_human_review").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("assistant_user_idx").on(t.userId, t.createdAt)]);


/**
 * Human review queue for questions the assistant can't answer from the records
 * (ambiguous cases, missing information, unmatched questions). Scoped to the
 * requesting organization.
 */
export const reviewRequests = pgTable("review_requests", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  interactionId: uuid("interaction_id").references(() => assistantInteractions.id),
  subjectType: varchar("subject_type", { length: 20 }),
  subjectId: uuid("subject_id"),
  question: text("question").notNull(),
  reason: text("reason").notNull(),
  status: reviewStatus("status").notNull().default("open"),
  response: text("response"),
  respondedBy: uuid("responded_by").references(() => users.id),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [index("review_requests_org_status_idx").on(t.organizationId, t.status, t.createdAt)]);

/**
 * Public "request access" submissions. Never creates an account: an administrator
 * reviews each request and, if appropriate, invites the person through user admin.
 * The submitter's IP is kept only as a keyed hash, for rate limiting.
 */
export const accessRequests = pgTable("access_requests", {
  id: id(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  organizationName: varchar("organization_name", { length: 200 }).notNull(),
  organizationType: varchar("organization_type", { length: 20 }).notNull(),
  jobTitle: varchar("job_title", { length: 100 }),
  phone: varchar("phone", { length: 30 }),
  message: text("message"),
  status: accessRequestStatus("status").notNull().default("pending"),
  ipHash: varchar("ip_hash", { length: 64 }).notNull(),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  ...timestamps,
}, (t) => [
  index("access_requests_status_idx").on(t.status, t.createdAt),
  index("access_requests_ip_idx").on(t.ipHash, t.createdAt),
  index("access_requests_email_idx").on(t.email),
  check("access_requests_email_lower_chk", sql`${t.email} = lower(${t.email})`),
  check("access_requests_org_type_chk", sql`${t.organizationType} in ('hospital', 'insurer', 'tpa', 'scheme_desk', 'other')`),
]);
