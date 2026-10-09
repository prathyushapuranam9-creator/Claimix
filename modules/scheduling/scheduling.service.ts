import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { randomToken } from "@/lib/security/crypto";
import { parseOrThrow, requireId, todayIso } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { HospitalRepository } from "@/modules/hospitals/hospitals.repository";
import { PatientRepository } from "@/modules/patients/patients.repository";
import { insertPatient, resolveRegisteringHospital } from "@/modules/patients/patients.service";
import { patientInputSchema } from "@/modules/patients/patients.validation";
import { SchedulingRepository } from "./scheduling.repository";
import { CONSENT_REQUIRED, dischargeSchema, doctorInputSchema, registrationInputSchema, slotOpeningSchema } from "./scheduling.validation";

/** The hospital whose front desk the caller works at. Platform admins pass one explicitly. */
function callerHospital(ctx: ServiceContext, scope: string, requested?: string): string | null {
  if (ctx.principal.orgType === "hospital" && ctx.principal.roleKey !== "patient") return ctx.principal.organizationId;
  if (scope === "all") return requested ?? null;
  return null;
}

function reference() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `REG-${d}-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}`;
}

/** "09:30:00" as stored by Postgres → "09:30" for display and comparison. */
export const hhmm = (t: string) => t.slice(0, 5);

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Doctors and their bookable slots. Reference data, so administrators maintain it. */
export const DoctorService = {
  async list(ctx: ServiceContext) {
    requirePermission(ctx.principal, "hospital:manage");
    return SchedulingRepository.allDoctors(ctx.db);
  },

  async add(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "hospital:manage");
    const d = parseOrThrow(doctorInputSchema, input);
    if (!(await HospitalRepository.exists(ctx.db, d.hospitalId))) {
      throw new ValidationError("Select a valid hospital.", { hospitalId: ["Select a valid hospital."] });
    }
    return ctx.db.transaction(async (tx) => {
      const row = await SchedulingRepository.insertDoctor(tx, {
        hospitalId: d.hospitalId,
        fullName: d.fullName,
        department: d.department,
        registrationNo: d.registrationNo ?? null,
        consultationFee: d.consultationFee.toFixed(2),
      });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "doctor.created",
        resourceType: "doctor",
        resourceId: row.id,
        newState: { hospitalId: d.hospitalId, fullName: d.fullName, department: d.department, consultationFee: row.consultationFee },
      });
      return row;
    });
  },

  /** Opens equal-length slots across a period on one day. Re-opening a period adds only what is missing. */
  async openSlots(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "hospital:manage");
    const d = parseOrThrow(slotOpeningSchema, input);
    const [doctor] = await SchedulingRepository.allDoctors(ctx.db).then((rows) => rows.filter((r) => r.id === d.doctorId));
    if (!doctor) throw new ValidationError("Select a valid doctor.", { doctorId: ["Select a valid doctor."] });

    const values: { doctorId: string; slotDate: string; startsAt: string; endsAt: string }[] = [];
    for (let start = d.from; addMinutes(start, d.minutes) <= d.to; start = addMinutes(start, d.minutes)) {
      values.push({ doctorId: d.doctorId, slotDate: d.slotDate, startsAt: start, endsAt: addMinutes(start, d.minutes) });
      if (values.length >= 200) break; // one day of slots is bounded
    }
    if (!values.length) throw new ValidationError("That period is shorter than one slot.", { to: ["Not enough time for a slot."] });

    return ctx.db.transaction(async (tx) => {
      const inserted = await SchedulingRepository.insertSlots(tx, values);
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "doctor.slots_opened",
        resourceType: "doctor",
        resourceId: d.doctorId,
        newState: { slotDate: d.slotDate, from: d.from, to: d.to, minutes: d.minutes, opened: inserted.length, requested: values.length },
      });
      return { opened: inserted.length, requested: values.length };
    });
  },
};

export interface SlotOption {
  id: string;
  startsAt: string;
  endsAt: string;
  taken: boolean;
}

/**
 * Front-desk patient registration. The patient is identified (found or newly entered), a doctor and a
 * free slot are chosen, the payment state is recorded and the rights & responsibilities acknowledgement
 * is given — and only then, in one transaction, is anything written.
 */
export const RegistrationService = {
  /** Step 1: find a patient already at this hospital by name, patient number or mobile. */
  async findPatients(ctx: ServiceContext, q: string) {
    const scope = requirePermission(ctx.principal, "patient:read");
    const term = q.trim();
    if (term.length < 2) return [];
    const page = await PatientRepository.list(ctx.db, ctx.principal, scope, { q: term, page: 1, pageSize: 10 });
    return page.rows.map((r) => ({ id: r.id, fullName: r.fullName, patientNo: r.patientNo, dob: r.dob, gender: r.gender, phone: r.phone, department: r.department }));
  },

  /** Departments at this hospital that have a doctor taking appointments. */
  async departments(ctx: ServiceContext, hospitalId?: string) {
    const scope = requirePermission(ctx.principal, "patient:write");
    const hospital = callerHospital(ctx, scope, hospitalId);
    if (!hospital) return [];
    return SchedulingRepository.departmentsWithDoctors(ctx.db, hospital);
  },

  /** Step 2: the doctors of one department at this hospital. */
  async doctors(ctx: ServiceContext, department: string, hospitalId?: string) {
    const scope = requirePermission(ctx.principal, "patient:write");
    const hospital = callerHospital(ctx, scope, hospitalId);
    if (!hospital) return [];
    const rows = await SchedulingRepository.doctorsForHospital(ctx.db, hospital, department);
    return rows.filter((r) => r.isActive);
  },

  /** Step 2: one doctor's slots on a date, each marked free or taken, plus the next days that have room. */
  async availability(ctx: ServiceContext, doctorId: string, slotDate: string, hospitalId?: string) {
    const scope = requirePermission(ctx.principal, "patient:write");
    const hospital = callerHospital(ctx, scope, hospitalId);
    if (!hospital) throw new ForbiddenError();
    const doctor = await SchedulingRepository.activeDoctor(ctx.db, hospital, requireId(doctorId, "Doctor"));
    if (!doctor) throw new NotFoundError("Doctor not found.");
    const [slots, days] = await Promise.all([
      SchedulingRepository.slotsForDay(ctx.db, doctor.id, slotDate),
      SchedulingRepository.daysWithFreeSlots(ctx.db, doctor.id, todayIso()),
    ]);
    return {
      doctor: { id: doctor.id, fullName: doctor.fullName, department: doctor.department, consultationFee: doctor.consultationFee },
      slots: slots.map((s): SlotOption => ({ id: s.id, startsAt: hhmm(s.startsAt), endsAt: hhmm(s.endsAt), taken: Boolean(s.taken) })),
      daysWithFreeSlots: days,
    };
  },

  /**
   * Completes the registration. Everything is re-checked here, whatever the browser sent: the
   * acknowledgement, the payment state, that the patient is this hospital's (or is created now), that
   * the doctor practises here, and that the slot is this doctor's and still free. The slot row is
   * locked for the transaction, and a unique index is the final guard against a double booking.
   */
  async register(ctx: ServiceContext, input: unknown) {
    const scope = requirePermission(ctx.principal, "patient:write");
    // Checked before anything else so the missing acknowledgement is named exactly, not folded into a
    // generic "fix the highlighted fields" (the schema refuses it again as a backstop).
    if (!(input as { consentAcknowledged?: unknown } | null)?.consentAcknowledged) {
      throw new ValidationError(CONSENT_REQUIRED, { consentAcknowledged: [CONSENT_REQUIRED] });
    }
    const d = parseOrThrow(registrationInputSchema, input);
    const hospitalId = await resolveRegisteringHospital(ctx, scope, d.newPatient?.hospitalId);

    return ctx.db.transaction(async (tx) => {
      // The patient: either one already at this hospital, or created here as part of the registration.
      let patient: { id: string; patientNo: string; fullName: string; hospitalId: string };
      if (d.patientId) {
        const found = await PatientRepository.findScoped(tx, ctx.principal, requirePermission(ctx.principal, "patient:read"), requireId(d.patientId, "Patient"));
        if (!found) throw new NotFoundError("Patient not found.");
        if (found.patient.hospitalId !== hospitalId) throw new NotFoundError("Patient not found.");
        patient = found.patient;
      } else {
        patient = await insertPatient(tx, ctx, hospitalId, parseOrThrow(patientInputSchema, d.newPatient));
      }

      const doctor = await SchedulingRepository.activeDoctor(tx, hospitalId, requireId(d.doctorId, "Doctor"));
      if (!doctor) throw new ValidationError("Select a doctor taking appointments at your hospital.", { doctorId: ["Select a valid doctor."] });

      const slot = await SchedulingRepository.lockSlot(tx, requireId(d.slotId, "Slot"));
      if (!slot || slot.doctor_id !== doctor.id) throw new ValidationError("Select one of this doctor's slots.", { slotId: ["Select a valid slot."] });
      if (slot.taken) throw new ConflictError("That slot has just been taken. Choose another available slot.");

      const fee = doctor.consultationFee;
      const paid = !d.collectPaymentLater;
      // Nothing to collect when the doctor has no fee configured: the visit is recorded as settled
      // with a zero amount and no method, rather than as money owed.
      const nothingToCollect = Number(fee) === 0;
      // A method is required only when there is something to collect; the schema cannot know the fee.
      if (!nothingToCollect && !d.collectPaymentLater && !d.paymentMethod) {
        throw new ValidationError("Choose how the amount was collected, or choose to collect it later.", {
          paymentMethod: ["Choose how the amount was collected, or choose to collect it later."],
        });
      }
      const row = await SchedulingRepository.insertAppointment(tx, {
        reference: reference(),
        hospitalId,
        patientId: patient.id,
        doctorId: doctor.id,
        slotId: slot.id,
        department: doctor.department,
        visitType: d.visitType,
        status: "booked",
        consultationFee: fee,
        amountCollected: paid ? fee : null,
        paymentMethod: paid && !nothingToCollect ? d.paymentMethod! : null,
        paymentReference: paid && !nothingToCollect ? d.paymentReference ?? null : null,
        paymentState: paid ? "paid" : "pending",
        consentAcknowledgedAt: new Date(),
        consentAcknowledgedBy: ctx.principal.userId,
        createdBy: ctx.principal.userId,
      });

      // An IP admission is a stay, not just an appointment: the registration opens it.
      const admission =
        d.visitType === "ip_admission"
          ? await SchedulingRepository.insertAdmission(tx, {
              appointmentId: row.id,
              hospitalId,
              patientId: patient.id,
              status: "admitted",
              ward: d.admission?.ward ?? null,
              bed: d.admission?.bed ?? null,
              expectedStayDays: d.admission?.expectedStayDays ?? null,
              admittedAt: new Date(),
              admittedBy: ctx.principal.userId,
            })
          : null;
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "registration.completed",
        resourceType: "appointment",
        resourceId: row.id,
        newState: {
          reference: row.reference,
          patientId: patient.id,
          newPatient: !d.patientId,
          doctorId: doctor.id,
          slotId: slot.id,
          department: doctor.department,
          visitType: d.visitType,
          paymentState: row.paymentState,
          paymentMethod: row.paymentMethod,
          paymentReference: row.paymentReference,
          admissionId: admission?.id ?? null,
          consentAcknowledged: true,
        },
      });
      return {
        appointment: row,
        admission,
        patient: { id: patient.id, patientNo: patient.patientNo, fullName: patient.fullName },
        doctorName: doctor.fullName,
        slot: { slotDate: slot.slot_date, startsAt: hhmm(slot.starts_at), endsAt: hhmm(slot.ends_at) },
      };
    });
  },

  /** A patient's visits, for their profile. */
  async forPatient(ctx: ServiceContext, patientId: string) {
    const scope = requirePermission(ctx.principal, "patient:read");
    const found = await PatientRepository.findScoped(ctx.db, ctx.principal, scope, requireId(patientId, "Patient"));
    if (!found) throw new NotFoundError("Patient not found.");
    return SchedulingRepository.forPatient(ctx.db, found.patient.id);
  },

  /** The front desk's own dashboard: today's registrations, what is still to collect, and free slots. */
  async dayOverview(ctx: ServiceContext, slotDate = todayIso()) {
    const scope = requirePermission(ctx.principal, "patient:write");
    const hospital = callerHospital(ctx, scope);
    if (!hospital) return null;
    const [summary, freeSlots, upcoming, admitted] = await Promise.all([
      SchedulingRepository.daySummary(ctx.db, hospital, slotDate),
      SchedulingRepository.freeSlotCount(ctx.db, hospital, slotDate),
      SchedulingRepository.list(ctx.db, ctx.principal, scope, { page: 1, pageSize: 8 }, { slotDate }),
      SchedulingRepository.currentAdmissions(ctx.db, hospital),
    ]);
    return { slotDate, ...summary, freeSlots, upcoming: upcoming.rows, inHospital: admitted.length };
  },

  /** The inpatients currently in the hospital. */
  async currentAdmissions(ctx: ServiceContext) {
    const scope = requirePermission(ctx.principal, "patient:read");
    const hospital = callerHospital(ctx, scope);
    if (!hospital) return [];
    return SchedulingRepository.currentAdmissions(ctx.db, hospital);
  },

  /** Ends a stay. Only the hospital that admitted the patient can discharge them. */
  async discharge(ctx: ServiceContext, admissionId: string, input: unknown) {
    const scope = requirePermission(ctx.principal, "patient:write");
    const d = parseOrThrow(dischargeSchema, input);
    const hospital = callerHospital(ctx, scope);
    if (!hospital) throw new ForbiddenError();
    return ctx.db.transaction(async (tx) => {
      const found = await SchedulingRepository.findAdmission(tx, requireId(admissionId, "Admission"));
      if (!found || found.admission.hospitalId !== hospital) throw new NotFoundError("Admission not found.");
      if (found.admission.status !== "admitted") throw new ConflictError("This patient has already been discharged.");
      const row = await SchedulingRepository.setAdmissionDischarged(tx, found.admission.id, {
        dischargedAt: new Date(),
        dischargedBy: ctx.principal.userId,
        dischargeNote: d.note ?? null,
      });
      if (!row) throw new ConflictError("This patient has already been discharged.");
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "admission.discharged",
        resourceType: "admission",
        resourceId: row.id,
        newState: { patientId: row.patientId, appointmentId: row.appointmentId, dischargedAt: row.dischargedAt },
      });
      return row;
    });
  },

  /** The appointment list / day sheet. */
  async list(ctx: ServiceContext, q: ListQuery, f: { slotDate?: string; paymentState?: "paid" | "pending"; visitType?: string }) {
    const scope = requirePermission(ctx.principal, "patient:read");
    return SchedulingRepository.list(ctx.db, ctx.principal, scope, q, f);
  },
};
