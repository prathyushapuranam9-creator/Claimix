import { boolean, check, date, index, integer, numeric, pgTable, text, time, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, softDelete, timestamps } from "./_common";
import { admissionStatus, appointmentStatus, paymentMethod, paymentState, visitType } from "./enums";
import { users } from "./identity";
import { hospitals, patients } from "./parties";

/**
 * Front-desk registration: the doctors a hospital offers, the slots they can be booked into, and the
 * visit a patient is registered for. A registration is one `appointments` row; it is written only when
 * the whole registration completes (patient identified, doctor and slot chosen, payment state recorded
 * and the rights & responsibilities acknowledgement given).
 */

export const doctors = pgTable("doctors", {
  id: id(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  /** A PATIENT_DEPARTMENTS key, so a doctor's department matches the one recorded on the patient. */
  department: varchar("department", { length: 40 }).notNull(),
  registrationNo: varchar("registration_no", { length: 60 }),
  consultationFee: numeric("consultation_fee", { precision: 14, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
  ...softDelete,
}, (t) => [
  index("doctors_hospital_dept_idx").on(t.hospitalId, t.department),
  check("doctors_fee_chk", sql`${t.consultationFee} >= 0`),
]);

/** One bookable period for one doctor. A slot exists only if the hospital has opened it. */
export const doctorSlots = pgTable("doctor_slots", {
  id: id(),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id),
  slotDate: date("slot_date").notNull(),
  startsAt: time("starts_at").notNull(),
  endsAt: time("ends_at").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  uniqueIndex("doctor_slots_uq").on(t.doctorId, t.slotDate, t.startsAt),
  index("doctor_slots_day_idx").on(t.doctorId, t.slotDate),
  check("doctor_slots_period_chk", sql`${t.endsAt} > ${t.startsAt}`),
]);

/**
 * A completed registration: the patient's visit with a doctor in a slot, its payment state and the
 * acknowledgement that was given. Cancelling frees the slot; a live appointment holds it exclusively.
 */
export const appointments = pgTable("appointments", {
  id: id(),
  reference: varchar("reference", { length: 40 }).notNull().unique(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id),
  slotId: uuid("slot_id").notNull().references(() => doctorSlots.id),
  department: varchar("department", { length: 40 }).notNull(),
  visitType: visitType("visit_type").notNull(),
  status: appointmentStatus("status").notNull().default("booked"),
  consultationFee: numeric("consultation_fee", { precision: 14, scale: 2 }).notNull(),
  /** Set only when money was taken at the desk; null while payment is still to be collected. */
  amountCollected: numeric("amount_collected", { precision: 14, scale: 2 }),
  paymentMethod: paymentMethod("payment_method"),
  /**
   * A non-sensitive handle on the payment: the card's last four digits, or the UPI reference. Full card
   * details are never sent to the server or stored.
   */
  paymentReference: varchar("payment_reference", { length: 40 }),
  paymentState: paymentState("payment_state").notNull(),
  /** The rights & responsibilities acknowledgement, without which registration cannot complete. */
  consentAcknowledgedAt: timestamp("consent_acknowledged_at", { withTimezone: true }).notNull(),
  consentAcknowledgedBy: uuid("consent_acknowledged_by").notNull().references(() => users.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  // One live appointment per slot: a booked slot can't be offered or taken twice.
  uniqueIndex("appointments_slot_live_uq").on(t.slotId).where(sql`${t.status} <> 'cancelled'`),
  index("appointments_hospital_status_idx").on(t.hospitalId, t.status),
  index("appointments_patient_idx").on(t.patientId),
  index("appointments_doctor_day_idx").on(t.doctorId, t.status),
  check("appointments_fee_chk", sql`${t.consultationFee} >= 0 AND (${t.amountCollected} IS NULL OR ${t.amountCollected} >= 0)`),
  // Paid means an amount was recorded, and a method too unless there was nothing to collect;
  // pending means neither was.
  check(
    "appointments_payment_chk",
    sql`(${t.paymentState} = 'paid' AND ${t.amountCollected} IS NOT NULL AND (${t.paymentMethod} IS NOT NULL OR ${t.amountCollected} = 0)) OR (${t.paymentState} = 'pending' AND ${t.paymentMethod} IS NULL AND ${t.amountCollected} IS NULL)`,
  ),
]);

/**
 * An inpatient stay. An IP admission is not an ordinary appointment: the visit books the admission
 * slot, and this row is the stay itself — admitted, then discharged. Created in the same transaction
 * as the registration when the visit type is "ip_admission".
 */
export const admissions = pgTable("admissions", {
  id: id(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  status: admissionStatus("status").notNull().default("admitted"),
  ward: varchar("ward", { length: 80 }),
  bed: varchar("bed", { length: 40 }),
  /** Length of stay the doctor expects, as recorded at admission. */
  expectedStayDays: integer("expected_stay_days"),
  admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull().defaultNow(),
  dischargedAt: timestamp("discharged_at", { withTimezone: true }),
  dischargeNote: text("discharge_note"),
  admittedBy: uuid("admitted_by").notNull().references(() => users.id),
  dischargedBy: uuid("discharged_by").references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  // One stay per registration.
  uniqueIndex("admissions_appointment_uq").on(t.appointmentId),
  index("admissions_hospital_status_idx").on(t.hospitalId, t.status),
  index("admissions_patient_idx").on(t.patientId),
  check("admissions_stay_chk", sql`${t.expectedStayDays} IS NULL OR (${t.expectedStayDays} >= 1 AND ${t.expectedStayDays} <= 365)`),
  // A discharge is recorded with who did it and when, together.
  check(
    "admissions_discharge_chk",
    sql`(${t.status} = 'discharged' AND ${t.dischargedAt} IS NOT NULL AND ${t.dischargedBy} IS NOT NULL) OR (${t.status} <> 'discharged' AND ${t.dischargedAt} IS NULL)`,
  ),
]);
