import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, type AnyColumn } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lookup } from "@/db/lookup";
import { beneficiaries, claims, diagnoses, documents, governmentSchemes, organizations, patients, payerResponses, policies, preAuthorizations, procedures, rejectionReasons, settlements } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import type { ClaimStatus } from "./claims.workflow";

/** Payers see a claim only once the hospital has submitted it (never drafts, even cancelled ones). */
const submittedTo = (col: AnyColumn) => (orgId: string) => and(eq(col, orgId), isNotNull(claims.submittedAt))!;

export const CLAIM_SCOPE: ScopeColumns = {
  hospitalId: claims.hospitalId,
  insurerId: submittedTo(claims.insurerId),
  tpaId: submittedTo(claims.tpaId),
  patientId: claims.patientId,
};

export interface ClaimFilters {
  status?: ClaimStatus[];
  insurerId?: string;
  tpaId?: string;
  schemeId?: string;
  hospitalId?: string;
  claimType?: "cashless" | "reimbursement";
  from?: string;
  to?: string;
}

export const CLAIM_SORTS = {
  updated: desc(claims.updatedAt),
  admission: desc(claims.admissionDate),
  amount: desc(claims.claimedAmount),
} as const;

export type ClaimSort = keyof typeof CLAIM_SORTS;

/** Latest query/rejection reason recorded by the payer (for list views). */
const lastReason = sql<string | null>`(
  select rr.title from ${payerResponses} pr join ${rejectionReasons} rr on rr.id = pr.rejection_reason_id
  where pr.subject_type = 'claim' and pr.subject_id = ${claims.id} and pr.decision in ('query', 'rejected')
  order by pr.created_at desc limit 1)`;

const docCount = sql<number>`(select count(*)::int from ${documents} d where d.subject_type = 'claim' and d.subject_id = ${claims.id} and d.deleted_at is null)`;

export function claimListWhere(principal: Principal, scope: Scope, q: Pick<ListQuery, "q">, f: ClaimFilters) {
  return andAll(
    scopePredicate(principal, scope, CLAIM_SCOPE),
    f.status?.length ? inArray(claims.status, f.status) : undefined,
    f.insurerId ? eq(claims.insurerId, f.insurerId) : undefined,
    f.tpaId ? eq(claims.tpaId, f.tpaId) : undefined,
    f.schemeId ? eq(claims.schemeId, f.schemeId) : undefined,
    f.hospitalId ? eq(claims.hospitalId, f.hospitalId) : undefined,
    f.claimType ? eq(claims.claimType, f.claimType) : undefined,
    f.from ? gte(claims.admissionDate, f.from) : undefined,
    f.to ? lte(claims.admissionDate, f.to) : undefined,
    q.q ? or(ilike(claims.reference, likeContains(q.q)), ilike(patients.fullName, likeContains(q.q))) : undefined,
  );
}

const listColumns = {
  id: claims.id,
  reference: claims.reference,
  claimType: claims.claimType,
  status: claims.status,
  admissionDate: claims.admissionDate,
  dischargeDate: claims.dischargeDate,
  claimedAmount: claims.claimedAmount,
  approvedAmount: claims.approvedAmount,
  patientAmount: claims.patientAmount,
  updatedAt: claims.updatedAt,
  isDemo: claims.isDemo,
  patientName: patients.fullName,
  policyName: lookup(policies, "name", claims.policyId),
  insurerName: lookup(organizations, "name", claims.insurerId),
  tpaName: lookup(organizations, "name", claims.tpaId),
  schemeName: lookup(governmentSchemes, "name", claims.schemeId),
  hospitalName: lookup(organizations, "name", claims.hospitalId),
  diagnosisCode: lookup(diagnoses, "code", claims.diagnosisId),
  procedureName: lookup(procedures, "name", claims.procedureId),
  lastReason,
  documentCount: docCount,
};

export const ClaimRepository = {
  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery, f: ClaimFilters, sort: ClaimSort = "updated") {
    const where = claimListWhere(principal, scope, q, f);
    const [rows, [total]] = await Promise.all([
      db.select(listColumns).from(claims).innerJoin(patients, eq(patients.id, claims.patientId)).where(where).orderBy(CLAIM_SORTS[sort], asc(claims.id)).limit(q.pageSize).offset(offsetOf(q)),
      db.select({ n: count() }).from(claims).innerJoin(patients, eq(patients.id, claims.patientId)).where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  /** Bounded export (no unbounded reads); larger exports belong in a background job. */
  async exportRows(db: DbOrTx, principal: Principal, scope: Scope, q: Pick<ListQuery, "q">, f: ClaimFilters, limit: number) {
    return db.select(listColumns).from(claims).innerJoin(patients, eq(patients.id, claims.patientId)).where(claimListWhere(principal, scope, q, f)).orderBy(desc(claims.updatedAt)).limit(limit);
  },

  async findScoped(db: DbOrTx, principal: Principal, scope: Scope, id: string, opts: { forUpdate?: boolean } = {}) {
    if (opts.forUpdate) await db.execute(sql`select 1 from ${claims} where ${claims.id} = ${id} for update`);
    const [row] = await db
      .select({
        claim: claims,
        patient: patients,
        beneficiary: beneficiaries,
        policy: policies,
        hospitalName: lookup(organizations, "name", claims.hospitalId),
        insurerName: lookup(organizations, "name", claims.insurerId),
        tpaName: lookup(organizations, "name", claims.tpaId),
        schemeName: lookup(governmentSchemes, "name", claims.schemeId),
        diagnosisCode: lookup(diagnoses, "code", claims.diagnosisId),
        diagnosisName: lookup(diagnoses, "name", claims.diagnosisId),
        procedureCode: lookup(procedures, "code", claims.procedureId),
        procedureName: lookup(procedures, "name", claims.procedureId),
      })
      .from(claims)
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .innerJoin(beneficiaries, eq(beneficiaries.id, claims.beneficiaryId))
      .innerJoin(policies, eq(policies.id, claims.policyId))
      .where(and(eq(claims.id, id), scopePredicate(principal, scope, CLAIM_SCOPE)))
      .limit(1);
    return row;
  },

  async insert(db: DbOrTx, values: typeof claims.$inferInsert) {
    const [row] = await db.insert(claims).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof claims.$inferInsert>) {
    const [row] = await db.update(claims).set(values).where(eq(claims.id, id)).returning();
    return row!;
  },

  async changeStatus(db: DbOrTx, id: string, from: ClaimStatus, values: Partial<typeof claims.$inferInsert> & { status: ClaimStatus }) {
    const [row] = await db.update(claims).set(values).where(and(eq(claims.id, id), eq(claims.status, from))).returning();
    return row;
  },

  async liveClaimForPreauth(db: DbOrTx, preAuthId: string) {
    const [row] = await db.select({ id: claims.id, reference: claims.reference }).from(claims).where(and(eq(claims.preAuthId, preAuthId), ne(claims.status, "cancelled"))).limit(1);
    return row;
  },

  /** Approved cashless pre-auths of a hospital that don't yet have a live claim. */
  async claimablePreauths(db: DbOrTx, hospitalId: string) {
    return db
      .select({
        id: preAuthorizations.id,
        reference: preAuthorizations.reference,
        status: preAuthorizations.status,
        approvedAmount: preAuthorizations.approvedAmount,
        expectedAdmission: preAuthorizations.expectedAdmission,
        patientName: lookup(patients, "full_name", preAuthorizations.patientId),
        procedureName: lookup(procedures, "name", preAuthorizations.procedureId),
      })
      .from(preAuthorizations)
      .where(and(
        eq(preAuthorizations.hospitalId, hospitalId),
        inArray(preAuthorizations.status, ["approved", "partially_approved"]),
        sql`not exists (select 1 from ${claims} c where c.pre_auth_id = ${preAuthorizations.id} and c.status <> 'cancelled')`,
      ))
      .orderBy(desc(preAuthorizations.updatedAt))
      .limit(100);
  },

  async preauthSummary(db: DbOrTx, preAuthId: string) {
    const [row] = await db
      .select({ id: preAuthorizations.id, reference: preAuthorizations.reference, status: preAuthorizations.status, approvedAmount: preAuthorizations.approvedAmount, estimatedCost: preAuthorizations.estimatedCost })
      .from(preAuthorizations)
      .where(eq(preAuthorizations.id, preAuthId))
      .limit(1);
    return row;
  },

  async settlement(db: DbOrTx, claimId: string) {
    const [row] = await db.select().from(settlements).where(eq(settlements.claimId, claimId)).limit(1);
    return row;
  },

  async insertSettlement(db: DbOrTx, values: typeof settlements.$inferInsert) {
    const [row] = await db.insert(settlements).values(values).returning();
    return row!;
  },

  /** Reduces the available sum insured after a settlement (never below zero). */
  async consumeBalance(db: DbOrTx, beneficiaryId: string, amount: string) {
    const [row] = await db
      .update(beneficiaries)
      .set({ sumInsuredAvailable: sql`greatest(0, ${beneficiaries.sumInsuredAvailable} - ${amount}::numeric)` })
      .where(and(eq(beneficiaries.id, beneficiaryId), sql`${beneficiaries.sumInsuredAvailable} is not null`, isNull(beneficiaries.deletedAt)))
      .returning({ sumInsuredAvailable: beneficiaries.sumInsuredAvailable });
    return row;
  },
};
