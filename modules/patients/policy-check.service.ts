import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lookup } from "@/db/lookup";
import { claims, diagnoses, documents, governmentSchemes, organizations, policies, preAuthorizations, procedures, settlements } from "@/db/schema";
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
        clinical: preAuthorizations.clinical,
        policyName: lookup(policies, "name", preAuthorizations.policyId),
        payerName: sql<string | null>`coalesce(${lookup(organizations, "name", preAuthorizations.insurerId)}, ${lookup(governmentSchemes, "name", preAuthorizations.schemeId)})`,
        tpaName: lookup(organizations, "name", preAuthorizations.tpaId),
        submittedAt: preAuthorizations.submittedAt,
        // Qualified on purpose: an unqualified "id" inside this subquery would bind to the claim's own id.
        liveClaimId: sql<string | null>`(select c.id::text from ${claims} c where c.pre_auth_id = "pre_authorizations"."id" and c.status <> 'cancelled' limit 1)`,
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
        billNumber: claims.billNumber,
        roomRentPerDay: claims.roomRentPerDay,
        nonPayableNotes: sql<string | null>`${claims.clinical}->>'nonPayableNotes'`,
        preauthReference: sql<string | null>`(select p.reference from ${preAuthorizations} p where p.id = ${claims.preAuthId})`,
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
    return { preauths: preauths ? preauths.map(shapePreauth) : null, claims: claimRows, documents: docs };
  },
};

type PreauthRow = Awaited<ReturnType<typeof PolicyCheckRepository.preauths>>[number];

/** One line of the pre-authorization's estimate as saved (older rows: description × quantity × amount). */
export interface CostLine {
  head: string;
  covers: string | null;
  perDay: number;
  days: number;
  amount: number;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function costLines(c: Record<string, unknown>): CostLine[] {
  if (!Array.isArray(c.costItems)) return [];
  return c.costItems.map((raw: Record<string, unknown>) => {
    const i = "head" in raw ? raw : { head: "Other", description: raw.description, perDay: raw.amount, days: raw.quantity };
    const perDay = Number(i.perDay) || 0;
    const days = Number(i.days) || 0;
    return { head: String(i.head ?? "Other"), covers: text(i.description), perDay, days, amount: perDay * days };
  });
}

/** The saved pre-authorization form, in display order (only what Claimix holds; Aadhaar is never included). */
function formSections(r: PreauthRow) {
  const c = (r.clinical ?? {}) as Record<string, unknown>;
  const k = (c.kyc && typeof c.kyc === "object" ? c.kyc : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(", ") : text(v));
  return [
    {
      title: "Patient and policy",
      rows: [
        ["Patient name", text(k.patientName)],
        ["UHID / IP number", text(k.uhid)],
        ["Mobile", text(k.mobile)],
        ["Payer", [r.payerName, r.tpaName].filter(Boolean).join(" · ") || null],
        ["Policy", r.policyName],
        ["Policy number", text(k.policyNumber)],
        ["TPA card / member ID", text(k.memberId)],
      ],
    },
    {
      title: "Clinical details",
      rows: [
        ["Treating doctor", text(c.doctorName)],
        ["Registration number", text(c.doctorRegistrationNo)],
        ["Department", text(c.department)],
        ["Presenting complaint", text(c.symptoms)],
        ["Diagnosis (ICD-10)", r.diagnosisCode ? `${r.diagnosisCode} — ${r.diagnosisName ?? ""}` : null],
        ["Line of treatment", text(c.treatmentType)],
        ["Treatment / package", r.procedureName],
        ["Past history of chronic illness", list(c.chronicIllness)],
        ["Relevant critical findings", text(c.criticalFindings)],
        ["Due to an accident", text(c.isAccident)],
        ["Pre-existing disease declared", text(c.pedDeclared)],
      ],
    },
    {
      title: "The stay",
      rows: [
        ["Admission type", text(c.admissionType)],
        ["Expected admission", r.expectedAdmission],
        ["Expected discharge", text(c.dischargeDate)],
        ["Expected length of stay (days)", r.expectedStayDays === null ? null : String(r.expectedStayDays)],
        ["Days in ICU", numOrNull(c.icuDays) === null ? null : String(c.icuDays)],
        ["Room category", r.roomCategory],
      ],
    },
  ].map((sec) => ({ title: sec.title, rows: sec.rows as [string, string | null][] }));
}

function shapePreauth(r: PreauthRow) {
  const { clinical, ...rest } = r;
  const c = (clinical ?? {}) as Record<string, unknown>;
  return { ...rest, form: formSections(r), cost: costLines(c), packageAmount: numOrNull(c.packageAmount) };
}

export type PolicyCheckData = Awaited<ReturnType<typeof PolicyCheckService.forPatient>>;
