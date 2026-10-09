import "server-only";
import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { randomToken } from "@/lib/security/crypto";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { HospitalRepository } from "@/modules/hospitals/hospitals.repository";
import { PatientRepository } from "./patients.repository";
import { patientInputSchema } from "./patients.validation";

/** Fields safe to put in audit state (no contact details or DOB). */
function auditView(p: { patientNo: string; fullName: string; gender: string; hospitalId: string; department?: string | null; abhaNumber?: string | null }) {
  // The ABHA number itself is a health identifier, so only whether one was recorded is audited.
  return { patientNo: p.patientNo, fullName: p.fullName, gender: p.gender, hospitalId: p.hospitalId, department: p.department ?? null, hasAbha: !!p.abhaNumber };
}

function generatePatientNo() {
  return `PT-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)}`;
}

/**
 * The hospital a patient is registered into: always the caller's own, unless a platform administrator
 * chooses one. A client-sent hospitalId is ignored for hospital staff.
 */
export async function resolveRegisteringHospital(ctx: ServiceContext, scope: string, requested: string | undefined): Promise<string> {
  if (scope === "all") {
    if (!requested) throw new ValidationError("Select the registering hospital.", { hospitalId: ["Select a hospital."] });
    if (!(await HospitalRepository.exists(ctx.db, requested))) throw new ValidationError("Select a valid hospital.", { hospitalId: ["Select a valid hospital."] });
    return requested;
  }
  if (scope === "organization" && ctx.principal.orgType === "hospital") return ctx.principal.organizationId;
  throw new ForbiddenError();
}

/**
 * Inserts one patient with the duplicate and patient-number checks, inside the caller's transaction.
 * Front-desk registration creates the patient and their first visit in a single transaction, so this
 * has to be callable from there as well as from the patient form.
 */
export async function insertPatient(tx: DbOrTx, ctx: ServiceContext, hospitalId: string, data: ReturnType<typeof patientInputSchema.parse>) {
  const patientNo = data.patientNo ?? generatePatientNo();
  // Same person registered twice is a likely mistake, but two people can share a name and birth date,
  // so this is a warning the user can confirm — not a rejection. Only this hospital's own records are checked.
  if (!data.confirmDuplicate) {
    const same = await PatientRepository.likelyDuplicates(tx, hospitalId, data.fullName, data.dob);
    if (same.length) {
      throw new ValidationError(
        `A patient named ${data.fullName} with this date of birth is already registered at this hospital (${same.map((s) => s.patientNo).join(", ")}). Check the existing record before creating another.`,
        { _duplicate: same.map((s) => `${s.id}|${s.patientNo}`) },
      );
    }
  }
  if (await PatientRepository.patientNoTaken(tx, hospitalId, patientNo)) {
    throw new ConflictError(`Patient number ${patientNo} is already in use at this hospital.`);
  }
  const row = await PatientRepository.insert(tx, {
    hospitalId,
    patientNo,
    fullName: data.fullName,
    dob: data.dob,
    gender: data.gender,
    phone: data.phone ?? null,
    email: data.email ?? null,
    department: data.department ?? null,
    visitReason: data.visitReason ?? null,
    abhaNumber: data.abhaNumber ?? null,
    abhaAddress: data.abhaAddress ?? null,
  });
  await AuditService.record(tx, {
    action: "patient.created",
    ...actorOf(ctx),
    resourceType: "patient",
    resourceId: row.id,
    newState: { ...auditView(row), ...(data.confirmDuplicate ? { confirmedPossibleDuplicate: true } : {}) },
  });
  return row;
}

export const PatientService = {
  async list(ctx: ServiceContext, q: ListQuery) {
    const scope = requirePermission(ctx.principal, "patient:read");
    return PatientRepository.list(ctx.db, ctx.principal, scope, q);
  },

  /** Scoped fetch; records a "patient.viewed" access event. */
  async get(ctx: ServiceContext, id: string) {
    const scope = requirePermission(ctx.principal, "patient:read");
    const row = await PatientRepository.findScoped(ctx.db, ctx.principal, scope, requireId(id, "Patient"));
    if (!row) throw new NotFoundError("Patient not found.");
    await AuditService.record(ctx.db, {
      action: "patient.viewed",
      ...actorOf(ctx),
      resourceType: "patient",
      resourceId: id,
    });
    return row;
  },

  async create(ctx: ServiceContext, input: unknown) {
    const scope = requirePermission(ctx.principal, "patient:write");
    const data = parseOrThrow(patientInputSchema, input);
    const hospitalId = await resolveRegisteringHospital(ctx, scope, data.hospitalId);
    return ctx.db.transaction(async (tx) => insertPatient(tx, ctx, hospitalId, data));
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    const scope = requirePermission(ctx.principal, "patient:write");
    const data = parseOrThrow(patientInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const current = await PatientRepository.findScoped(tx, ctx.principal, scope, requireId(id, "Patient"));
      if (!current) throw new NotFoundError("Patient not found.");
      const before = current.patient;
      const patientNo = data.patientNo ?? before.patientNo;
      if (patientNo !== before.patientNo && (await PatientRepository.patientNoTaken(tx, before.hospitalId, patientNo, id))) {
        throw new ConflictError(`Patient number ${patientNo} is already in use at this hospital.`);
      }
      // The registering hospital never changes through an edit.
      const row = await PatientRepository.update(tx, id, {
        patientNo,
        fullName: data.fullName,
        dob: data.dob,
        gender: data.gender,
        phone: data.phone ?? null,
        email: data.email ?? null,
        department: data.department ?? null,
        visitReason: data.visitReason ?? null,
        abhaNumber: data.abhaNumber ?? null,
        abhaAddress: data.abhaAddress ?? null,
      });
      await AuditService.record(tx, {
        action: "patient.updated",
        ...actorOf(ctx),
        resourceType: "patient",
        resourceId: id,
        previousState: auditView(before),
        newState: auditView(row),
      });
      return row;
    });
  },
};
