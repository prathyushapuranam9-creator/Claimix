import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { admissions, appointments, doctors, doctorSlots, organizations, patients, users } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";
import { offsetOf, type ListQuery } from "@/lib/pagination";

/** Appointments belong to the hospital that registered them; a patient portal user sees their own. */
export const APPOINTMENT_SCOPE: ScopeColumns = {
  hospitalId: appointments.hospitalId,
  patientId: appointments.patientId,
};

/**
 * A slot is taken when a live (not cancelled) appointment holds it. Joined rather than written as a
 * correlated subquery: inside a single-table select list Drizzle renders a column unqualified, which
 * would silently compare against the subquery's own table.
 */
const liveAppointmentForSlot = () => and(eq(appointments.slotId, doctorSlots.id), ne(appointments.status, "cancelled"));

export const SchedulingRepository = {
  // ---------------------------------------------------------------- doctors

  async insertDoctor(db: DbOrTx, values: typeof doctors.$inferInsert) {
    const [row] = await db.insert(doctors).values(values).returning();
    return row!;
  },

  async doctorsForHospital(db: DbOrTx, hospitalId: string, department?: string) {
    return db
      .select({
        id: doctors.id,
        fullName: doctors.fullName,
        department: doctors.department,
        registrationNo: doctors.registrationNo,
        consultationFee: doctors.consultationFee,
        isActive: doctors.isActive,
      })
      .from(doctors)
      .where(and(eq(doctors.hospitalId, hospitalId), isNull(doctors.deletedAt), department ? eq(doctors.department, department) : undefined))
      .orderBy(asc(doctors.department), asc(doctors.fullName));
  },

  /** All doctors with their hospital, for the administrator's maintenance page. */
  async allDoctors(db: DbOrTx) {
    return db
      .select({
        id: doctors.id,
        fullName: doctors.fullName,
        department: doctors.department,
        registrationNo: doctors.registrationNo,
        consultationFee: doctors.consultationFee,
        isActive: doctors.isActive,
        hospitalId: doctors.hospitalId,
        hospitalName: organizations.name,
        slots: sql<number>`(select count(*)::int from ${doctorSlots} s where s.doctor_id = ${sql.identifier("doctors")}.${sql.identifier("id")})`,
      })
      .from(doctors)
      .innerJoin(organizations, eq(organizations.id, doctors.hospitalId))
      .where(isNull(doctors.deletedAt))
      .orderBy(asc(organizations.name), asc(doctors.department), asc(doctors.fullName));
  },

  /** The doctor, only if they practise at this hospital and are still offered. */
  async activeDoctor(db: DbOrTx, hospitalId: string, doctorId: string) {
    const [row] = await db
      .select()
      .from(doctors)
      .where(and(eq(doctors.id, doctorId), eq(doctors.hospitalId, hospitalId), eq(doctors.isActive, true), isNull(doctors.deletedAt)))
      .limit(1);
    return row;
  },

  /** Departments at this hospital that actually have a doctor taking appointments. */
  async departmentsWithDoctors(db: DbOrTx, hospitalId: string) {
    const rows = await db
      .selectDistinct({ department: doctors.department })
      .from(doctors)
      .where(and(eq(doctors.hospitalId, hospitalId), eq(doctors.isActive, true), isNull(doctors.deletedAt)))
      .orderBy(asc(doctors.department));
    return rows.map((r) => r.department);
  },

  // ---------------------------------------------------------------- slots

  async insertSlots(db: DbOrTx, values: (typeof doctorSlots.$inferInsert)[]) {
    if (!values.length) return [];
    return db.insert(doctorSlots).values(values).onConflictDoNothing().returning({ id: doctorSlots.id });
  },

  /** The doctor's slots on one day, each marked as already taken or free. */
  async slotsForDay(db: DbOrTx, doctorId: string, slotDate: string) {
    return db
      .select({
        id: doctorSlots.id,
        slotDate: doctorSlots.slotDate,
        startsAt: doctorSlots.startsAt,
        endsAt: doctorSlots.endsAt,
        taken: isNotNull(appointments.id),
      })
      .from(doctorSlots)
      .leftJoin(appointments, liveAppointmentForSlot())
      .where(and(eq(doctorSlots.doctorId, doctorId), eq(doctorSlots.slotDate, slotDate)))
      .orderBy(asc(doctorSlots.startsAt));
  },

  /** The days from `from` onwards on which this doctor has at least one free slot. */
  async daysWithFreeSlots(db: DbOrTx, doctorId: string, from: string, limit = 30) {
    const rows = await db
      .select({ slotDate: doctorSlots.slotDate, free: count(doctorSlots.id) })
      .from(doctorSlots)
      .leftJoin(appointments, liveAppointmentForSlot())
      .where(and(eq(doctorSlots.doctorId, doctorId), gte(doctorSlots.slotDate, from), isNull(appointments.id)))
      .groupBy(doctorSlots.slotDate)
      .orderBy(asc(doctorSlots.slotDate))
      .limit(limit);
    return rows.map((r) => ({ slotDate: r.slotDate, free: Number(r.free) }));
  },

  /**
   * Locks the slot row and reports whether it is already held, so two desks registering into the same
   * slot cannot both succeed (the unique index is the final guarantee).
   */
  async lockSlot(db: DbOrTx, slotId: string) {
    const [row] = await db.execute<{ id: string; doctor_id: string; slot_date: string; starts_at: string; ends_at: string; taken: boolean }>(sql`
      select s.id, s.doctor_id, s.slot_date, s.starts_at, s.ends_at,
             exists (select 1 from ${appointments} a where a.slot_id = s.id and a.status <> 'cancelled') as taken
        from ${doctorSlots} s
       where s.id = ${slotId}
         for no key update of s
    `);
    return row;
  },

  // ---------------------------------------------------------------- appointments

  async insertAppointment(db: DbOrTx, values: typeof appointments.$inferInsert) {
    const [row] = await db.insert(appointments).values(values).returning();
    return row!;
  },

  async insertAdmission(db: DbOrTx, values: typeof admissions.$inferInsert) {
    const [row] = await db.insert(admissions).values(values).returning();
    return row!;
  },

  /** The stay for one registration, if it is an inpatient one. */
  async admissionForAppointment(db: DbOrTx, appointmentId: string) {
    const [row] = await db.select().from(admissions).where(eq(admissions.appointmentId, appointmentId)).limit(1);
    return row;
  },

  async findAdmission(db: DbOrTx, admissionId: string) {
    const [row] = await db
      .select({ admission: admissions, patientName: patients.fullName, patientNo: patients.patientNo })
      .from(admissions)
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .where(eq(admissions.id, admissionId))
      .limit(1);
    return row;
  },

  async setAdmissionDischarged(db: DbOrTx, admissionId: string, values: { dischargedAt: Date; dischargedBy: string; dischargeNote: string | null }) {
    const [row] = await db
      .update(admissions)
      .set({ status: "discharged", ...values })
      .where(and(eq(admissions.id, admissionId), eq(admissions.status, "admitted")))
      .returning();
    return row;
  },

  /** Inpatients currently in the hospital. */
  async currentAdmissions(db: DbOrTx, hospitalId: string) {
    return db
      .select({
        id: admissions.id,
        patientId: admissions.patientId,
        patientName: patients.fullName,
        patientNo: patients.patientNo,
        ward: admissions.ward,
        bed: admissions.bed,
        expectedStayDays: admissions.expectedStayDays,
        admittedAt: admissions.admittedAt,
        doctorName: doctors.fullName,
      })
      .from(admissions)
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .innerJoin(appointments, eq(appointments.id, admissions.appointmentId))
      .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
      .where(and(eq(admissions.hospitalId, hospitalId), eq(admissions.status, "admitted")))
      .orderBy(desc(admissions.admittedAt));
  },

  /** A patient's visits, newest first. Scoped by the patient the caller may already see. */
  async forPatient(db: DbOrTx, patientId: string) {
    return db
      .select({
        id: appointments.id,
        reference: appointments.reference,
        visitType: appointments.visitType,
        status: appointments.status,
        department: appointments.department,
        doctorName: doctors.fullName,
        slotDate: doctorSlots.slotDate,
        startsAt: doctorSlots.startsAt,
        endsAt: doctorSlots.endsAt,
        consultationFee: appointments.consultationFee,
        amountCollected: appointments.amountCollected,
        paymentMethod: appointments.paymentMethod,
        paymentReference: appointments.paymentReference,
        paymentState: appointments.paymentState,
        admissionId: admissions.id,
        admissionStatus: admissions.status,
        ward: admissions.ward,
        bed: admissions.bed,
        admittedAt: admissions.admittedAt,
        dischargedAt: admissions.dischargedAt,
        createdAt: appointments.createdAt,
      })
      .from(appointments)
      .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
      .innerJoin(doctorSlots, eq(doctorSlots.id, appointments.slotId))
      .leftJoin(admissions, eq(admissions.appointmentId, appointments.id))
      .where(eq(appointments.patientId, patientId))
      .orderBy(desc(doctorSlots.slotDate), desc(doctorSlots.startsAt));
  },

  /** Front-desk figures for one hospital on one day. */
  async daySummary(db: DbOrTx, hospitalId: string, slotDate: string) {
    const [row] = await db
      .select({
        booked: sql<number>`count(*) filter (where ${appointments.status} = 'booked')::int`,
        toCollect: sql<number>`count(*) filter (where ${appointments.paymentState} = 'pending' and ${appointments.status} <> 'cancelled')::int`,
        collected: sql<string>`coalesce(sum(${appointments.amountCollected}) filter (where ${appointments.status} <> 'cancelled'), 0)::text`,
      })
      .from(appointments)
      .innerJoin(doctorSlots, eq(doctorSlots.id, appointments.slotId))
      .where(and(eq(appointments.hospitalId, hospitalId), eq(doctorSlots.slotDate, slotDate)));
    return { booked: row?.booked ?? 0, toCollect: row?.toCollect ?? 0, collected: row?.collected ?? "0" };
  },

  /** How many free slots the hospital still has on a day, across its doctors. */
  async freeSlotCount(db: DbOrTx, hospitalId: string, slotDate: string) {
    const [row] = await db
      .select({ n: count(doctorSlots.id) })
      .from(doctorSlots)
      .innerJoin(doctors, eq(doctors.id, doctorSlots.doctorId))
      .leftJoin(appointments, liveAppointmentForSlot())
      .where(and(eq(doctors.hospitalId, hospitalId), eq(doctors.isActive, true), isNull(doctors.deletedAt), eq(doctorSlots.slotDate, slotDate), isNull(appointments.id)));
    return Number(row?.n ?? 0);
  },

  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery, f: { slotDate?: string; paymentState?: "paid" | "pending"; visitType?: string }) {
    const where = andAll(
      scopePredicate(principal, scope, APPOINTMENT_SCOPE),
      f.slotDate ? eq(doctorSlots.slotDate, f.slotDate) : undefined,
      f.paymentState ? eq(appointments.paymentState, f.paymentState) : undefined,
      f.visitType ? eq(appointments.visitType, f.visitType as "opd_consultation") : undefined,
    );
    const rows = await db
      .select({
        id: appointments.id,
        reference: appointments.reference,
        status: appointments.status,
        visitType: appointments.visitType,
        department: appointments.department,
        patientId: appointments.patientId,
        patientName: patients.fullName,
        patientNo: patients.patientNo,
        doctorName: doctors.fullName,
        slotDate: doctorSlots.slotDate,
        startsAt: doctorSlots.startsAt,
        paymentState: appointments.paymentState,
        paymentMethod: appointments.paymentMethod,
        consultationFee: appointments.consultationFee,
        amountCollected: appointments.amountCollected,
        endsAt: doctorSlots.endsAt,
        registeredBy: users.fullName,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
      .innerJoin(doctorSlots, eq(doctorSlots.id, appointments.slotId))
      .leftJoin(users, eq(users.id, appointments.createdBy))
      .where(where)
      .orderBy(asc(doctorSlots.slotDate), asc(doctorSlots.startsAt))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [total] = await db
      .select({ n: count() })
      .from(appointments)
      .innerJoin(doctorSlots, eq(doctorSlots.id, appointments.slotId))
      .where(where);
    return { rows, total: total?.n ?? 0 };
  },
};
