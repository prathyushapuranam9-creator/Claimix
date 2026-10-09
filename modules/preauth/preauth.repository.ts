import "server-only";
import { aliasedTable, and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lookup } from "@/db/lookup";
import {
  beneficiaries, diagnoses, governmentSchemes, organizations, patients, payerResponses, permissions, policies, preAuthorizations, procedures, queries, rejectionReasons, rolePermissions, statusHistory, users,
} from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import type { PreauthStatus } from "./preauth.workflow";

/**
 * Payers see a request once the hospital has submitted it (never a hospital's drafts, even cancelled ones),
 * and the requests they raised themselves on a hospital's behalf (New Claim wizard), drafts included.
 */
const submittedTo = (col: AnyColumn) => (orgId: string) =>
  or(and(eq(col, orgId), isNotNull(preAuthorizations.submittedAt)), eq(preAuthorizations.raisedByOrgId, orgId))!;

export const PREAUTH_SCOPE: ScopeColumns = {
  hospitalId: preAuthorizations.hospitalId,
  insurerId: submittedTo(preAuthorizations.insurerId),
  tpaId: submittedTo(preAuthorizations.tpaId),
  patientId: preAuthorizations.patientId,
  policyId: preAuthorizations.policyId,
};


const memberInsurer = aliasedTable(organizations, "member_insurer");
const memberTpa = aliasedTable(organizations, "member_tpa");
const memberHospital = aliasedTable(organizations, "member_hospital");

const memberColumns = {
  beneficiaryId: beneficiaries.id,
  memberId: beneficiaries.memberId,
  relationship: beneficiaries.relationship,
  coverStart: beneficiaries.coverStart,
  coverEnd: beneficiaries.coverEnd,
  sumInsured: beneficiaries.sumInsured,
  sumInsuredAvailable: beneficiaries.sumInsuredAvailable,
  patientId: patients.id,
  patientNo: patients.patientNo,
  fullName: patients.fullName,
  gender: patients.gender,
  dob: patients.dob,
  phone: patients.phone,
  department: patients.department,
  hospitalId: patients.hospitalId,
  hospitalName: memberHospital.name,
  policyId: policies.id,
  policyName: policies.name,
  insurerId: policies.insurerId,
  tpaId: policies.tpaId,
  insurerName: memberInsurer.name,
  tpaName: memberTpa.name,
};

/** A payer's member as the New Claim wizard shows it (patient + coverage + policy). */
export interface MemberRow {
  beneficiaryId: string;
  memberId: string;
  relationship: string;
  coverStart: string;
  coverEnd: string;
  sumInsured: string | null;
  sumInsuredAvailable: string | null;
  patientId: string;
  patientNo: string;
  fullName: string;
  gender: string;
  dob: string;
  phone: string | null;
  department: string | null;
  hospitalId: string;
  hospitalName: string;
  policyId: string;
  policyName: string;
  insurerId: string | null;
  tpaId: string | null;
  insurerName: string | null;
  tpaName: string | null;
}

/** Members (recorded coverage) under policies of one insurer / TPA — the only people it may raise a request for. */
function members(db: DbOrTx, payer: { orgType: "insurer" | "tpa"; orgId: string }, extra: SQL) {
  return db
    .select(memberColumns)
    .from(beneficiaries)
    .innerJoin(patients, eq(patients.id, beneficiaries.patientId))
    .innerJoin(policies, eq(policies.id, beneficiaries.policyId))
    .innerJoin(memberHospital, eq(memberHospital.id, patients.hospitalId))
    .leftJoin(memberInsurer, eq(memberInsurer.id, policies.insurerId))
    .leftJoin(memberTpa, eq(memberTpa.id, policies.tpaId))
    .where(and(
      isNull(beneficiaries.deletedAt),
      isNull(patients.deletedAt),
      isNull(policies.deletedAt),
      payer.orgType === "insurer" ? eq(policies.insurerId, payer.orgId) : eq(policies.tpaId, payer.orgId),
      extra,
    ));
}

export const PreauthRepository = {
  /** Look up the payer's own members by UHID (hospital patient number), member ID or name. */
  async findMembers(db: DbOrTx, payer: { orgType: "insurer" | "tpa"; orgId: string }, q: string): Promise<MemberRow[]> {
    const term = likeContains(q);
    return members(db, payer, or(ilike(patients.patientNo, term), ilike(beneficiaries.memberId, term), ilike(patients.fullName, term))!)
      .orderBy(asc(patients.fullName))
      .limit(20) as Promise<MemberRow[]>;
  },

  /** The payer's members with exactly this member ID (case-insensitive). */
  async membersByMemberId(db: DbOrTx, payer: { orgType: "insurer" | "tpa"; orgId: string }, memberId: string): Promise<MemberRow[]> {
    return members(db, payer, sql`lower(${beneficiaries.memberId}) = lower(${memberId})`).limit(5) as Promise<MemberRow[]>;
  },

  /**
   * KYC & Policy dropdowns: the insurers the payer works with (an insurer: itself; a TPA: the insurers whose policies it
   * runs) and, per insurer, the TPAs on those policies.
   */
  async kycOptions(db: DbOrTx, payer: { orgType: "insurer" | "tpa"; orgId: string }) {
    const rows = (await db
      .selectDistinct({ insurerId: policies.insurerId, insurerName: memberInsurer.name, tpaId: policies.tpaId, tpaName: memberTpa.name })
      .from(policies)
      .innerJoin(memberInsurer, eq(memberInsurer.id, policies.insurerId))
      .leftJoin(memberTpa, eq(memberTpa.id, policies.tpaId))
      .where(and(isNull(policies.deletedAt), payer.orgType === "insurer" ? eq(policies.insurerId, payer.orgId) : eq(policies.tpaId, payer.orgId)))) as { insurerId: string | null; insurerName: string; tpaId: string | null; tpaName: string | null }[];
    const insurers = new Map<string, string>();
    const tpas: Record<string, { id: string; name: string }[]> = {};
    for (const r of rows) {
      if (!r.insurerId) continue;
      insurers.set(r.insurerId, r.insurerName);
      tpas[r.insurerId] ??= [];
      if (r.tpaId && r.tpaName && !tpas[r.insurerId]!.some((t) => t.id === r.tpaId)) tpas[r.insurerId]!.push({ id: r.tpaId, name: r.tpaName });
    }
    return {
      insurers: [...insurers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      tpasByInsurer: tpas,
    };
  },

  /** Drafts an insurer / TPA raised and has not submitted yet (New Claim wizard: resume). */
  async raisedDrafts(db: DbOrTx, orgId: string) {
    return db
      .select({ id: preAuthorizations.id, reference: preAuthorizations.reference, patientName: patients.fullName, patientNo: patients.patientNo, updatedAt: preAuthorizations.updatedAt })
      .from(preAuthorizations)
      .innerJoin(patients, eq(patients.id, preAuthorizations.patientId))
      .where(and(eq(preAuthorizations.raisedByOrgId, orgId), eq(preAuthorizations.status, "draft")))
      .orderBy(desc(preAuthorizations.updatedAt))
      .limit(20);
  },

  /** One member (coverage) of the payer, or undefined if it isn't theirs. */
  async member(db: DbOrTx, payer: { orgType: "insurer" | "tpa"; orgId: string }, beneficiaryId: string): Promise<MemberRow | undefined> {
    const [row] = (await members(db, payer, eq(beneficiaries.id, beneficiaryId)).limit(1)) as MemberRow[];
    return row;
  },

  /**
   * Names of these payer organizations (insurer / TPA) that have no active user who can review pre-authorizations.
   * A request routed to such an organization is stored correctly but nobody can see it, so the hospital is told.
   */
  async payersWithoutReviewers(db: DbOrTx, orgIds: string[]) {
    if (orgIds.length === 0) return [];
    const rows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(and(
        inArray(organizations.id, orgIds),
        sql`not exists (
          select 1 from ${users}
          join ${rolePermissions} rp on rp.role_id = ${users.roleId}
          join ${permissions} perm on perm.id = rp.permission_id and perm.key = 'preauth:review'
          where ${users.organizationId} = ${organizations.id} and ${users.isActive} = true and ${users.deletedAt} is null
        )`,
      ));
    return rows.map((r) => r.name);
  },

  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery, f: { status?: PreauthStatus[]; insurerId?: string; tpaId?: string; hospitalId?: string }) {
    const where = andAll(
      scopePredicate(principal, scope, PREAUTH_SCOPE),
      f.status?.length ? inArray(preAuthorizations.status, f.status) : undefined,
      f.insurerId ? eq(preAuthorizations.insurerId, f.insurerId) : undefined,
      f.tpaId ? eq(preAuthorizations.tpaId, f.tpaId) : undefined,
      f.hospitalId ? eq(preAuthorizations.hospitalId, f.hospitalId) : undefined,
      q.q ? or(ilike(preAuthorizations.reference, likeContains(q.q)), ilike(patients.fullName, likeContains(q.q))) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: preAuthorizations.id,
          reference: preAuthorizations.reference,
          status: preAuthorizations.status,
          claimType: preAuthorizations.claimType,
          estimatedCost: preAuthorizations.estimatedCost,
          approvedAmount: preAuthorizations.approvedAmount,
          expectedAdmission: preAuthorizations.expectedAdmission,
          updatedAt: preAuthorizations.updatedAt,
          isDemo: preAuthorizations.isDemo,
          patientName: patients.fullName,
          hospitalName: lookup(organizations, "name", preAuthorizations.hospitalId),
          policyName: lookup(policies, "name", preAuthorizations.policyId),
          insurerName: lookup(organizations, "name", preAuthorizations.insurerId),
          schemeName: lookup(governmentSchemes, "name", preAuthorizations.schemeId),
          procedureName: lookup(procedures, "name", preAuthorizations.procedureId),
        })
        .from(preAuthorizations)
        .innerJoin(patients, eq(patients.id, preAuthorizations.patientId))
        .where(where)
        .orderBy(desc(preAuthorizations.updatedAt), asc(preAuthorizations.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ n: count() }).from(preAuthorizations).innerJoin(patients, eq(patients.id, preAuthorizations.patientId)).where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  /** Full record for the detail page, only if inside the caller's scope. */
  async findScoped(db: DbOrTx, principal: Principal, scope: Scope, id: string, opts: { forUpdate?: boolean } = {}) {
    // Row lock (inside a transaction) serializes concurrent status changes on the same request.
    if (opts.forUpdate) await db.execute(sql`select 1 from ${preAuthorizations} where ${preAuthorizations.id} = ${id} for update`);
    const [row] = await db
      .select({
        preauth: preAuthorizations,
        patient: patients,
        beneficiary: beneficiaries,
        policy: policies,
        // Lookup names as scalar subqueries: one round trip, simple types.
        hospitalName: lookup(organizations, "name", preAuthorizations.hospitalId),
        insurerName: lookup(organizations, "name", preAuthorizations.insurerId),
        tpaName: lookup(organizations, "name", preAuthorizations.tpaId),
        schemeName: lookup(governmentSchemes, "name", preAuthorizations.schemeId),
        diagnosisCode: lookup(diagnoses, "code", preAuthorizations.diagnosisId),
        diagnosisName: lookup(diagnoses, "name", preAuthorizations.diagnosisId),
        procedureCode: lookup(procedures, "code", preAuthorizations.procedureId),
        procedureName: lookup(procedures, "name", preAuthorizations.procedureId),
      })
      .from(preAuthorizations)
      .innerJoin(patients, eq(patients.id, preAuthorizations.patientId))
      .innerJoin(beneficiaries, eq(beneficiaries.id, preAuthorizations.beneficiaryId))
      .innerJoin(policies, eq(policies.id, preAuthorizations.policyId))
      .where(and(eq(preAuthorizations.id, id), scopePredicate(principal, scope, PREAUTH_SCOPE)))
      .limit(1);
    return row;
  },

  async insert(db: DbOrTx, values: typeof preAuthorizations.$inferInsert) {
    const [row] = await db.insert(preAuthorizations).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof preAuthorizations.$inferInsert>) {
    const [row] = await db.update(preAuthorizations).set(values).where(eq(preAuthorizations.id, id)).returning();
    return row!;
  },

  /** Optimistic status change: only succeeds if the status is still `from`. */
  async changeStatus(db: DbOrTx, id: string, from: PreauthStatus, values: Partial<typeof preAuthorizations.$inferInsert> & { status: PreauthStatus }) {
    const [row] = await db
      .update(preAuthorizations)
      .set(values)
      .where(and(eq(preAuthorizations.id, id), eq(preAuthorizations.status, from)))
      .returning();
    return row;
  },

  async history(db: DbOrTx, id: string) {
    return db
      .select({
        id: statusHistory.id,
        fromStatus: statusHistory.fromStatus,
        toStatus: statusHistory.toStatus,
        reason: statusHistory.reason,
        message: statusHistory.message,
        requiredAction: statusHistory.requiredAction,
        requiredDocuments: statusHistory.requiredDocuments,
        responsibleTeam: statusHistory.responsibleTeam,
        createdAt: statusHistory.createdAt,
        actorName: users.fullName,
      })
      .from(statusHistory)
      .leftJoin(users, eq(users.id, statusHistory.actorUserId))
      .where(and(eq(statusHistory.subjectType, "preauth"), eq(statusHistory.subjectId, id)))
      .orderBy(asc(statusHistory.createdAt));
  },

  async insertHistory(db: DbOrTx, values: typeof statusHistory.$inferInsert) {
    await db.insert(statusHistory).values(values);
  },

  async insertPayerResponse(db: DbOrTx, values: typeof payerResponses.$inferInsert) {
    const [row] = await db.insert(payerResponses).values(values).returning();
    return row!;
  },

  async openQueries(db: DbOrTx, subjectId: string) {
    return db.select().from(queries).where(and(eq(queries.subjectType, "preauth"), eq(queries.subjectId, subjectId), eq(queries.status, "open")));
  },

  async insertQuery(db: DbOrTx, values: typeof queries.$inferInsert) {
    await db.insert(queries).values(values);
  },

  async respondToQueries(db: DbOrTx, subjectId: string, userId: string, message: string) {
    await db
      .update(queries)
      .set({ status: "responded", responseMessage: message, respondedBy: userId, respondedAt: new Date() })
      .where(and(eq(queries.subjectType, "preauth"), eq(queries.subjectId, subjectId), eq(queries.status, "open")));
  },

  async queriesFor(db: DbOrTx, subjectId: string) {
    return db
      .select({ query: queries, reasonTitle: rejectionReasons.title, reasonAction: rejectionReasons.requiredAction })
      .from(queries)
      .leftJoin(rejectionReasons, eq(rejectionReasons.id, queries.reasonId))
      .where(and(eq(queries.subjectType, "preauth"), eq(queries.subjectId, subjectId)))
      .orderBy(desc(queries.createdAt));
  },

  async reason(db: DbOrTx, id: string) {
    const [row] = await db.select().from(rejectionReasons).where(eq(rejectionReasons.id, id)).limit(1);
    return row;
  },

  async reasons(db: DbOrTx) {
    return db.select().from(rejectionReasons).orderBy(asc(rejectionReasons.title));
  },

  async activeBeneficiaryPolicy(db: DbOrTx, beneficiaryId: string) {
    const [row] = await db
      .select({ beneficiary: beneficiaries, policy: policies })
      .from(beneficiaries)
      .innerJoin(policies, eq(policies.id, beneficiaries.policyId))
      .where(and(eq(beneficiaries.id, beneficiaryId), isNull(beneficiaries.deletedAt)))
      .limit(1);
    return row;
  },
};
