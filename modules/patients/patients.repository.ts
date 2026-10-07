import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { claims, organizations, patients, preAuthorizations } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";
import { likeContains, offsetOf, type ListQuery, type Paged } from "@/lib/pagination";

/**
 * Patients belong to the registering hospital. Payers (insurer/TPA) reach a
 * patient only through a claim or pre-authorization assigned to them.
 */
export const PATIENT_SCOPE: ScopeColumns = {
  hospitalId: patients.hospitalId,
  patientId: patients.id,
  insurerId: (orgId) => sql`(
    exists (select 1 from ${claims} where ${claims.patientId} = ${patients.id} and ${claims.insurerId} = ${orgId} and ${claims.submittedAt} is not null)
    or exists (select 1 from ${preAuthorizations} where ${preAuthorizations.patientId} = ${patients.id} and ${preAuthorizations.insurerId} = ${orgId} and ${preAuthorizations.submittedAt} is not null)
  )`,
  tpaId: (orgId) => sql`(
    exists (select 1 from ${claims} where ${claims.patientId} = ${patients.id} and ${claims.tpaId} = ${orgId} and ${claims.submittedAt} is not null)
    or exists (select 1 from ${preAuthorizations} where ${preAuthorizations.patientId} = ${patients.id} and ${preAuthorizations.tpaId} = ${orgId} and ${preAuthorizations.submittedAt} is not null)
  )`,
  // Narrowed to one policy: patients with a submitted pre-auth or claim under it.
  policyId: (policyId) => sql`(
    exists (select 1 from ${claims} where ${claims.patientId} = ${patients.id} and ${claims.policyId} = ${policyId} and ${claims.submittedAt} is not null)
    or exists (select 1 from ${preAuthorizations} where ${preAuthorizations.patientId} = ${patients.id} and ${preAuthorizations.policyId} = ${policyId} and ${preAuthorizations.submittedAt} is not null)
  )`,
};

const listColumns = {
  id: patients.id,
  patientNo: patients.patientNo,
  fullName: patients.fullName,
  dob: patients.dob,
  gender: patients.gender,
  phone: patients.phone,
  department: patients.department,
  hospitalId: patients.hospitalId,
  hospitalName: organizations.name,
  isDemo: patients.isDemo,
  createdAt: patients.createdAt,
};

export type PatientListRow = { [K in keyof typeof listColumns]: (typeof listColumns)[K]["_"]["data"] };

export const PatientRepository = {
  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery): Promise<Paged<PatientListRow>> {
    const where = andAll(
      isNull(patients.deletedAt),
      scopePredicate(principal, scope, PATIENT_SCOPE),
      q.q ? or(ilike(patients.fullName, likeContains(q.q)), ilike(patients.patientNo, likeContains(q.q))) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select(listColumns)
        .from(patients)
        .innerJoin(organizations, eq(organizations.id, patients.hospitalId))
        .where(where)
        .orderBy(desc(patients.createdAt), asc(patients.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ n: count() }).from(patients).where(where),
    ]);
    return { rows: rows as PatientListRow[], total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  /** Returns the patient only if it is inside the caller's scope. */
  async findScoped(db: DbOrTx, principal: Principal, scope: Scope, id: string) {
    const [row] = await db
      .select({ patient: patients, hospitalName: organizations.name })
      .from(patients)
      .innerJoin(organizations, eq(organizations.id, patients.hospitalId))
      .where(and(eq(patients.id, id), isNull(patients.deletedAt), scopePredicate(principal, scope, PATIENT_SCOPE)))
      .limit(1);
    return row;
  },

  async insert(db: DbOrTx, values: typeof patients.$inferInsert) {
    const [row] = await db.insert(patients).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof patients.$inferInsert>) {
    const [row] = await db.update(patients).set(values).where(eq(patients.id, id)).returning();
    return row!;
  },

  /**
   * Patients already registered at this hospital with the same name (ignoring case and extra spaces) and date of
   * birth. Used to warn about a likely repeat registration; it is never a hard rule.
   */
  async likelyDuplicates(db: DbOrTx, hospitalId: string, fullName: string, dob: string) {
    const normalized = fullName.trim().replace(/\s+/g, " ").toLowerCase();
    return db
      .select({ id: patients.id, patientNo: patients.patientNo })
      .from(patients)
      .where(and(
        eq(patients.hospitalId, hospitalId),
        isNull(patients.deletedAt),
        eq(patients.dob, dob),
        sql`lower(regexp_replace(trim(${patients.fullName}), '\\s+', ' ', 'g')) = ${normalized}`,
      ))
      .orderBy(asc(patients.createdAt))
      .limit(5);
  },

  async patientNoTaken(db: DbOrTx, hospitalId: string, patientNo: string, exceptId?: string) {
    const [row] = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.hospitalId, hospitalId), eq(patients.patientNo, patientNo), exceptId ? sql`${patients.id} <> ${exceptId}` : undefined))
      .limit(1);
    return !!row;
  },
};
