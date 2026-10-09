import { boolean, check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, softDelete, timestamps } from "./_common";
import { gender, networkStatus } from "./enums";
import { organizations, users } from "./identity";

// Hospitals, insurers and TPAs share their primary key with organizations:
// the profile id IS the organization id, which is the tenant scope everywhere.
const orgPk = () => uuid("id").primaryKey().references(() => organizations.id);

export const hospitals = pgTable("hospitals", {
  id: orgPk(),
  registrationNo: varchar("registration_no", { length: 100 }),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 100 }).notNull(),
  address: text("address"),
  departments: jsonb("departments").$type<string[]>().notNull().default([]),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 320 }),
  ...timestamps,
  ...softDelete,
}, (t) => [index("hospitals_city_idx").on(t.state, t.city)]);

export const insurers = pgTable("insurers", {
  id: orgPk(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  claimsPhone: varchar("claims_phone", { length: 30 }),
  claimsEmail: varchar("claims_email", { length: 320 }),
  website: varchar("website", { length: 300 }),
  ...timestamps,
  ...softDelete,
});

export const tpas = pgTable("tpas", {
  id: orgPk(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 320 }),
  ...timestamps,
  ...softDelete,
});

export const governmentSchemes = pgTable("government_schemes", {
  id: id(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  authority: varchar("authority", { length: 200 }).notNull(),
  description: text("description"),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
  ...softDelete,
});

export const patients = pgTable("patients", {
  id: id(),
  // Registering hospital: the tenant scope for staff access.
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  // Optional portal login; a patient user may only reach this row.
  userId: uuid("user_id").unique().references(() => users.id),
  patientNo: varchar("patient_no", { length: 40 }).notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  dob: date("dob").notNull(),
  gender: gender("gender").notNull().default("undisclosed"),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 320 }),
  // Department the patient is registered / being treated in (a PATIENT_DEPARTMENTS key); null = not assigned.
  department: varchar("department", { length: 40 }),
  // Plain-language reason for the visit, as recorded by the hospital; null = not recorded.
  visitReason: varchar("visit_reason", { length: 300 }),
  /**
   * The patient's ABHA (Ayushman Bharat Health Account), when they have one and gave it. Recorded as
   * presented: Claimix has no ABDM integration, so nothing here is verified against ABDM or created
   * there. Registration never requires it.
   */
  abhaNumber: varchar("abha_number", { length: 17 }),
  abhaAddress: varchar("abha_address", { length: 120 }),
  // Aadhaar is never stored in full: a keyed hash for exact lookups and the last 4 digits for masked display / partial search.
  aadhaarHash: varchar("aadhaar_hash", { length: 64 }),
  aadhaarLast4: varchar("aadhaar_last4", { length: 4 }),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
  ...softDelete,
}, (t) => [
  uniqueIndex("patients_hospital_no_uq").on(t.hospitalId, t.patientNo),
  index("patients_name_idx").on(t.fullName),
  index("patients_aadhaar_hash_idx").on(t.aadhaarHash),
  index("patients_aadhaar_last4_idx").on(t.aadhaarLast4),
]);

export const hospitalNetworks = pgTable("hospital_networks", {
  id: id(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  insurerId: uuid("insurer_id").references(() => insurers.id),
  tpaId: uuid("tpa_id").references(() => tpas.id),
  schemeId: uuid("scheme_id").references(() => governmentSchemes.id),
  status: networkStatus("status").notNull().default("unverified"),
  cashlessAvailable: boolean("cashless_available").notNull().default(false),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("hospital_networks_hospital_idx").on(t.hospitalId),
  index("hospital_networks_insurer_idx").on(t.insurerId),
  index("hospital_networks_scheme_idx").on(t.schemeId),
  // Exactly one payer per row, and at most one row per hospital/payer pair.
  check("hospital_networks_one_payer_chk", sql`num_nonnulls(${t.insurerId}, ${t.tpaId}, ${t.schemeId}) = 1`),
  uniqueIndex("hospital_networks_insurer_uq").on(t.hospitalId, t.insurerId).where(sql`${t.insurerId} IS NOT NULL`),
  uniqueIndex("hospital_networks_tpa_uq").on(t.hospitalId, t.tpaId).where(sql`${t.tpaId} IS NOT NULL`),
  uniqueIndex("hospital_networks_scheme_uq").on(t.hospitalId, t.schemeId).where(sql`${t.schemeId} IS NOT NULL`),
]);
