import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { claims, organizations, patients, preAuthorizations } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import { scopeFor, type Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";
import { likeContains, offsetOf, type ListQuery, type Paged } from "@/lib/pagination";
import { CLAIM_SCOPE } from "@/modules/claims/claims.repository";
import { PREAUTH_SCOPE } from "@/modules/preauth/preauth.repository";

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
    or exists (select 1 from ${preAuthorizations} where ${preAuthorizations.patientId} = ${patients.id} and ${preAuthorizations.raisedByOrgId} = ${orgId})
  )`,
  tpaId: (orgId) => sql`(
    exists (select 1 from ${claims} where ${claims.patientId} = ${patients.id} and ${claims.tpaId} = ${orgId} and ${claims.submittedAt} is not null)
    or exists (select 1 from ${preAuthorizations} where ${preAuthorizations.patientId} = ${patients.id} and ${preAuthorizations.tpaId} = ${orgId} and ${preAuthorizations.submittedAt} is not null)
    or exists (select 1 from ${preAuthorizations} where ${preAuthorizations.patientId} = ${patients.id} and ${preAuthorizations.raisedByOrgId} = ${orgId})
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

export type PatientListRow = { [K in keyof typeof listColumns]: (typeof listColumns)[K]["_"]["data"] } & {
  /** Pre-Auth / Claims views: the patient's latest case in that view (null in the Patients view). */
  caseId: string | null;
  caseRef: string | null;
  caseStatus: string | null;
};

/** Patients | Pre-Auth | Claims on the Patients page. Existing statuses only; nothing is duplicated. */
export const PATIENT_VIEWS = ["patients", "preauth", "claims"] as const;
export type PatientView = (typeof PATIENT_VIEWS)[number];

/** Awaiting the payer's decision. */
const PREAUTH_AWAITING = ["submitted", "pending", "query"] as const;
/** Approved: the patient moves on to Claims once a claim is started from it (Submit). */
export const PREAUTH_APPROVED = ["approved", "partially_approved", "final_approved"] as const;

/** A live claim on this pre-auth (the same rule as the unique index claims_preauth_live_uq). */
/** Written with explicit table names: an unqualified "id" inside the subquery would bind to the claim's own id. */
const liveClaimForPreauth = sql`exists (select 1 from ${claims} lc where lc.pre_auth_id = "pre_authorizations"."id" and lc.status <> 'cancelled')`;

/**
 * The cases behind a view, limited to the cases the viewer may open (their own pre-auth / claim scope).
 * Pre-Auth: awaiting a decision, or approved with no live claim yet. Claims: any claim that isn't cancelled.
 */
function viewCases(principal: Principal, view: PatientView) {
  if (view === "preauth") {
    const scope = scopeFor(principal, "preauth:read");
    if (!scope) return null;
    return and(
      eq(preAuthorizations.patientId, patients.id),
      or(inArray(preAuthorizations.status, [...PREAUTH_AWAITING]), and(inArray(preAuthorizations.status, [...PREAUTH_APPROVED]), sql`not ${liveClaimForPreauth}`)),
      scopePredicate(principal, scope, PREAUTH_SCOPE),
    );
  }
  if (view === "claims") {
    const scope = scopeFor(principal, "claim:read");
    if (!scope) return null;
    return and(eq(claims.patientId, patients.id), ne(claims.status, "cancelled"), scopePredicate(principal, scope, CLAIM_SCOPE));
  }
  return undefined;
}

/**
 * Matches a search term against the mobile number by digits alone, so a number typed without the
 * country code or spacing still finds "+91 98765 43210". A term with no digits never matches.
 */
function phoneMatches(term: string) {
  const digits = term.replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  return sql`regexp_replace(coalesce(${patients.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`;
}

export const PatientRepository = {
  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery, view: PatientView = "patients"): Promise<Paged<PatientListRow>> {
    const cases = viewCases(principal, view);
    // No access to that kind of case: the view is simply empty.
    if (cases === null) return { rows: [], total: 0, page: q.page, pageSize: q.pageSize };
    const table = view === "claims" ? claims : preAuthorizations;
    const inView = cases ? sql`exists (select 1 from ${table} where ${cases})` : undefined;
    // The latest case of the view (reference + status), from the same scoped set of cases.
    const latest = (col: SQL) =>
      cases ? sql<string | null>`(select ${col} from ${table} where ${cases} order by ${view === "claims" ? claims.updatedAt : preAuthorizations.updatedAt} desc limit 1)` : sql<string | null>`null`;
    const where = andAll(
      isNull(patients.deletedAt),
      scopePredicate(principal, scope, PATIENT_SCOPE),
      inView,
      q.q ? or(ilike(patients.fullName, likeContains(q.q)), ilike(patients.patientNo, likeContains(q.q)), phoneMatches(q.q)) : undefined,
    );
    const ref = view === "claims" ? claims : preAuthorizations;
    const [rows, [total]] = await Promise.all([
      db
        .select({
          ...listColumns,
          caseId: latest(sql`${ref.id}::text`),
          caseRef: latest(sql`${ref.reference}`),
          caseStatus: latest(sql`${ref.status}::text`),
        })
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
  /** Another patient at this hospital with the same Aadhaar (compared by its keyed hash). */
  async aadhaarTaken(db: DbOrTx, hospitalId: string, hash: string, exceptId?: string) {
    const [row] = await db
      .select({ id: patients.id, patientNo: patients.patientNo })
      .from(patients)
      .where(and(eq(patients.hospitalId, hospitalId), isNull(patients.deletedAt), eq(patients.aadhaarHash, hash), exceptId ? ne(patients.id, exceptId) : undefined))
      .limit(1);
    return row;
  },

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
