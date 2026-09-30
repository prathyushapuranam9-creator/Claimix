import "server-only";
import { and, count, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lookup } from "@/db/lookup";
import { claims, documents, patients, preAuthorizations, ruleEvaluations, users } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate } from "@/lib/permissions/scope";
import { offsetOf, type ListQuery } from "@/lib/pagination";
import { CLAIM_SCOPE } from "@/modules/claims/claims.repository";
import { PREAUTH_SCOPE } from "@/modules/preauth/preauth.repository";
import { DOCUMENT_SCOPE } from "./documents.repository";

export type DocStatus = "uploaded" | "verified" | "rejected" | "requires_reupload";

const subjectRef = sql<string | null>`coalesce(
  (select p.reference from ${preAuthorizations} p where ${documents.subjectType} = 'preauth' and p.id = ${documents.subjectId}),
  (select c.reference from ${claims} c where ${documents.subjectType} = 'claim' and c.id = ${documents.subjectId}))`;

/** Missing mandatory documents recorded by a stored evaluation (no re-run needed). */
const missingFromEvaluation = sql<string[]>`coalesce((
  select jsonb_agg(distinct m) from jsonb_array_elements(${ruleEvaluations.results}) r,
  jsonb_array_elements_text(coalesce(r->'data'->'missingDocuments', '[]'::jsonb)) m
  where r->>'kind' = 'required_documents' and r->>'outcome' = 'FAIL'), '[]'::jsonb)`;

export const DocumentQueries = {
  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery, f: { status?: DocStatus; subjectType?: "preauth" | "claim" }) {
    const where = andAll(
      isNull(documents.deletedAt),
      isNotNull(documents.subjectId),
      scopePredicate(principal, scope, DOCUMENT_SCOPE),
      f.status ? eq(documents.status, f.status) : undefined,
      f.subjectType ? eq(documents.subjectType, f.subjectType) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: documents.id,
          docType: documents.docType,
          status: documents.status,
          scanStatus: documents.scanStatus,
          originalName: documents.originalName,
          sizeBytes: documents.sizeBytes,
          statusNote: documents.statusNote,
          createdAt: documents.createdAt,
          subjectType: documents.subjectType,
          subjectId: documents.subjectId,
          subjectRef,
          patientName: lookup(patients, "full_name", documents.patientId),
          uploadedByName: users.fullName,
        })
        .from(documents)
        .leftJoin(users, eq(users.id, documents.uploadedBy))
        .where(where)
        .orderBy(desc(documents.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ n: count() }).from(documents).where(where),
    ]);
    return { rows, total: total?.n ?? 0 };
  },

  /** Open requests whose latest checks found missing mandatory documents, or with documents needing re-upload. */
  async missing(db: DbOrTx, principal: Principal, preauthScope: Scope | null, claimScope: Scope | null) {
    const reupload = (type: "preauth" | "claim", idCol: typeof preAuthorizations.id | typeof claims.id) =>
      sql<number>`(select count(*)::int from ${documents} d where d.subject_type = ${type} and d.subject_id = ${idCol} and d.status in ('rejected', 'requires_reupload') and d.deleted_at is null)`;
    const [pre, cl] = await Promise.all([
      preauthScope
        ? db
            .select({ id: preAuthorizations.id, reference: preAuthorizations.reference, status: preAuthorizations.status, patientName: lookup(patients, "full_name", preAuthorizations.patientId), missing: missingFromEvaluation, reupload: reupload("preauth", preAuthorizations.id) })
            .from(preAuthorizations)
            .leftJoin(ruleEvaluations, eq(ruleEvaluations.id, preAuthorizations.latestEvaluationId))
            .where(and(inArray(preAuthorizations.status, ["draft", "submitted", "pending", "query"]), scopePredicate(principal, preauthScope, PREAUTH_SCOPE)))
            .orderBy(desc(preAuthorizations.updatedAt))
            .limit(100)
        : Promise.resolve([]),
      claimScope
        ? db
            .select({ id: claims.id, reference: claims.reference, status: claims.status, patientName: lookup(patients, "full_name", claims.patientId), missing: missingFromEvaluation, reupload: reupload("claim", claims.id) })
            .from(claims)
            .leftJoin(ruleEvaluations, eq(ruleEvaluations.id, claims.latestEvaluationId))
            .where(and(inArray(claims.status, ["draft", "submitted", "pending", "query"]), scopePredicate(principal, claimScope, CLAIM_SCOPE)))
            .orderBy(desc(claims.updatedAt))
            .limit(100)
        : Promise.resolve([]),
    ]);
    return [
      ...pre.map((r) => ({ ...r, kind: "preauth" as const })),
      ...cl.map((r) => ({ ...r, kind: "claim" as const })),
    ].filter((r) => r.missing.length > 0 || r.reupload > 0);
  },
};
