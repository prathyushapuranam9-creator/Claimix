import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type AnyColumn } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lookup } from "@/db/lookup";
import {
  beneficiaries, diagnoses, governmentSchemes, organizations, patients, payerResponses, policies, preAuthorizations, procedures, queries, rejectionReasons, statusHistory, users,
} from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import type { PreauthStatus } from "./preauth.workflow";

/** Payers see a request only once the hospital has submitted it (never drafts, even cancelled ones). */
const submittedTo = (col: AnyColumn) => (orgId: string) => and(eq(col, orgId), isNotNull(preAuthorizations.submittedAt))!;

export const PREAUTH_SCOPE: ScopeColumns = {
  hospitalId: preAuthorizations.hospitalId,
  insurerId: submittedTo(preAuthorizations.insurerId),
  tpaId: submittedTo(preAuthorizations.tpaId),
  patientId: preAuthorizations.patientId,
};


export const PreauthRepository = {
  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery, f: { status?: PreauthStatus[] }) {
    const where = andAll(
      scopePredicate(principal, scope, PREAUTH_SCOPE),
      f.status?.length ? inArray(preAuthorizations.status, f.status) : undefined,
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
