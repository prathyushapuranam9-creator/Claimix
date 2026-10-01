import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lookup } from "@/db/lookup";
import { claims, diagnoses, documents, governmentSchemes, organizations, preAuthorizations, procedures, settlements } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import type { Scope } from "@/lib/permissions/catalog";
import { scopeFor, type Principal } from "@/lib/permissions/principal";
import { scopePredicate } from "@/lib/permissions/scope";
import { CLAIM_SCOPE } from "@/modules/claims/claims.repository";
import { DOCUMENT_SCOPE } from "@/modules/documents/documents.repository";
import { PREAUTH_SCOPE } from "@/modules/preauth/preauth.repository";
import { PatientService } from "./patients.service";

const LIMIT = 50;

/** The patient's pre-authorizations, claims and documents — only rows the viewer may already open. */
const PolicyCheckRepository = {
  preauths(db: DbOrTx, principal: Principal, scope: Scope, patientId: string) {
    return db
      .select({
        id: preAuthorizations.id,
        reference: preAuthorizations.reference,
        status: preAuthorizations.status,
        claimType: preAuthorizations.claimType,
        diagnosisCode: lookup(diagnoses, "code", preAuthorizations.diagnosisId),
        diagnosisName: lookup(diagnoses, "name", preAuthorizations.diagnosisId),
        procedureName: lookup(procedures, "name", preAuthorizations.procedureId),
        expectedAdmission: preAuthorizations.expectedAdmission,
        expectedStayDays: preAuthorizations.expectedStayDays,
        roomCategory: preAuthorizations.roomCategory,
        roomRentPerDay: preAuthorizations.roomRentPerDay,
        estimatedCost: preAuthorizations.estimatedCost,
        expectedInsuranceAmount: preAuthorizations.expectedInsuranceAmount,
        patientContribution: preAuthorizations.patientContribution,
        approvedAmount: preAuthorizations.approvedAmount,
        isAccident: sql<string | null>`${preAuthorizations.clinical}->>'isAccident'`,
        pedDeclared: sql<string | null>`${preAuthorizations.clinical}->>'pedDeclared'`,
        pedRelated: sql<string | null>`${preAuthorizations.clinical}->>'pedRelated'`,
        updatedAt: preAuthorizations.updatedAt,
      })
      .from(preAuthorizations)
      .where(and(eq(preAuthorizations.patientId, patientId), scopePredicate(principal, scope, PREAUTH_SCOPE)))
      .orderBy(desc(preAuthorizations.updatedAt))
      .limit(LIMIT);
  },

  claims(db: DbOrTx, principal: Principal, scope: Scope, patientId: string) {
    return db
      .select({
        id: claims.id,
        reference: claims.reference,
        status: claims.status,
        claimType: claims.claimType,
        diagnosisCode: lookup(diagnoses, "code", claims.diagnosisId),
        diagnosisName: lookup(diagnoses, "name", claims.diagnosisId),
        procedureName: lookup(procedures, "name", claims.procedureId),
        admissionDate: claims.admissionDate,
        dischargeDate: claims.dischargeDate,
        payerName: sql<string | null>`coalesce(${lookup(organizations, "name", claims.insurerId)}, ${lookup(governmentSchemes, "name", claims.schemeId)})`,
        claimedAmount: claims.claimedAmount,
        approvedAmount: claims.approvedAmount,
        patientAmount: claims.patientAmount,
        received: sql<string | null>`(select ${settlements.amount} from ${settlements} where ${settlements.claimId} = ${claims.id} and ${settlements.status} = 'paid')`,
        updatedAt: claims.updatedAt,
      })
      .from(claims)
      .where(and(eq(claims.patientId, patientId), scopePredicate(principal, scope, CLAIM_SCOPE)))
      .orderBy(desc(claims.updatedAt))
      .limit(LIMIT);
  },

  documents(db: DbOrTx, principal: Principal, scope: Scope, patientId: string) {
    return db
      .select({
        id: documents.id,
        docType: documents.docType,
        category: documents.category,
        status: documents.status,
        originalName: documents.originalName,
        subjectType: documents.subjectType,
        subjectRef: sql<string | null>`case ${documents.subjectType}
          when 'preauth' then (select p.reference from ${preAuthorizations} p where p.id = ${documents.subjectId})
          when 'claim' then (select c.reference from ${claims} c where c.id = ${documents.subjectId})
          end`,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(eq(documents.patientId, patientId), isNull(documents.deletedAt), scopePredicate(principal, scope, DOCUMENT_SCOPE)))
      .orderBy(desc(documents.createdAt))
      .limit(LIMIT);
  },
};

/**
 * Everything the Policy Check block shows for one patient. The patient itself is
 * resolved through PatientService (tenant-scoped; 404 otherwise); each section is
 * loaded only with the matching read permission and its own tenant scope.
 */
export const PolicyCheckService = {
  async forPatient(ctx: ServiceContext, patientId: string) {
    const { patient } = await PatientService.get(ctx, patientId);
    const p = ctx.principal;
    const pre = scopeFor(p, "preauth:read");
    const cl = scopeFor(p, "claim:read");
    const doc = scopeFor(p, "document:read");
    const [preauths, claimRows, docs] = await Promise.all([
      pre ? PolicyCheckRepository.preauths(ctx.db, p, pre, patient.id) : null,
      cl ? PolicyCheckRepository.claims(ctx.db, p, cl, patient.id) : null,
      doc ? PolicyCheckRepository.documents(ctx.db, p, doc, patient.id) : null,
    ]);
    return { preauths, claims: claimRows, documents: docs };
  },
};

export type PolicyCheckData = Awaited<ReturnType<typeof PolicyCheckService.forPatient>>;
