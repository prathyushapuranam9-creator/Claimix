import "server-only";
import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { isInsuranceDocumentType } from "@/modules/documents/document-types";
import { DocumentRepository } from "@/modules/documents/documents.repository";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import { CoverageRepository } from "./coverage.repository";
import { coverageInputSchema } from "./coverage.validation";
import { PatientRepository } from "./patients.repository";

const money = (n: number | undefined) => (n === undefined ? null : n.toFixed(2));

/**
 * The insurance document the details were read from, if one was named. It must be one of THIS
 * patient's coverage-stage documents; a document id from another patient is refused rather than
 * silently dropped, so a coverage row can never cite evidence that isn't the patient's.
 * (The database enforces the same rule in a trigger.)
 */
async function resolveSourceDocument(tx: DbOrTx, ctx: ServiceContext, patientId: string, documentId: string | undefined) {
  if (!documentId) return null;
  const doc = await DocumentRepository.findScoped(tx, ctx.principal, requirePermission(ctx.principal, "document:read"), documentId);
  if (!doc || doc.patientId !== patientId || doc.subjectId || !isInsuranceDocumentType(doc.docType)) {
    throw new ValidationError("That insurance document doesn't belong to this patient.", { sourceDocumentId: ["Select one of this patient's insurance documents."] });
  }
  return doc.id;
}

function auditView(d: ReturnType<typeof coverageInputSchema.parse>, policyId: string) {
  return {
    policyId,
    memberId: d.memberId,
    policyNumber: d.policyNumber ?? null,
    policyholderName: d.policyholderName ?? null,
    relationship: d.relationship,
    coverStart: d.coverStart,
    coverEnd: d.coverEnd,
    inceptionDate: d.inceptionDate ?? null,
    verificationStatus: d.verificationStatus,
    sourceDocumentId: d.sourceDocumentId ?? null,
  };
}

export const CoverageService = {
  async forPatient(ctx: ServiceContext, patientId: string) {
    requirePermission(ctx.principal, "policy:read");
    const scope = requirePermission(ctx.principal, "patient:read");
    const p = await PatientRepository.findScoped(ctx.db, ctx.principal, scope, requireId(patientId, "Patient"));
    if (!p) throw new NotFoundError("Patient not found.");
    const rows = await CoverageRepository.forPatient(ctx.db, patientId);
    // Narrowed to one policy (insurance testing context): only that policy's coverage.
    return ctx.principal.policyId ? rows.filter((r) => r.policyId === ctx.principal.policyId) : rows;
  },

  async get(ctx: ServiceContext, beneficiaryId: string) {
    requirePermission(ctx.principal, "policy:read");
    const scope = requirePermission(ctx.principal, "patient:read");
    const row = await CoverageRepository.findScoped(ctx.db, ctx.principal, scope, requireId(beneficiaryId, "Coverage"));
    if (!row) throw new NotFoundError("Coverage not found.");
    return row;
  },

  /** Picker for new pre-authorizations: only the caller's own hospital patients. */
  async pickerForHospital(ctx: ServiceContext, q: string | undefined) {
    requirePermission(ctx.principal, "preauth:create");
    if (ctx.principal.orgType !== "hospital" || ctx.principal.roleKey === "patient") return [];
    return CoverageRepository.searchForHospital(ctx.db, ctx.principal.organizationId, q);
  },

  /**
   * Records a patient's policy or scheme enrolment exactly as shown on the card / scheme record, or as
   * entered by hand when the document isn't available yet. The insurance document is optional
   * throughout: without it the coverage is simply recorded as still requiring verification.
   */
  async add(ctx: ServiceContext, patientId: string, input: unknown) {
    requirePermission(ctx.principal, "policy:read");
    const scope = requirePermission(ctx.principal, "patient:write");
    const d = parseOrThrow(coverageInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const p = await PatientRepository.findScoped(tx, ctx.principal, scope, requireId(patientId, "Patient"));
      if (!p) throw new NotFoundError("Patient not found.");
      const policy = await PolicyRepository.get(tx, d.policyId);
      if (!policy || !policy.isActive) throw new ValidationError("Select an available policy or scheme.", { policyId: ["Select a valid policy or scheme."] });
      if (await CoverageRepository.memberIdTaken(tx, policy.category, d.memberId)) {
        throw new ConflictError("This member / beneficiary ID is already recorded for another patient. Check the card for typing errors.");
      }
      const sourceDocumentId = await resolveSourceDocument(tx, ctx, p.patient.id, d.sourceDocumentId);
      const row = await CoverageRepository.insert(tx, {
        patientId: p.patient.id,
        category: policy.category,
        policyId: policy.id,
        schemeId: policy.schemeId,
        memberId: d.memberId,
        policyNumber: d.policyNumber ?? null,
        policyholderName: d.policyholderName ?? null,
        relationship: d.relationship,
        coverStart: d.coverStart,
        coverEnd: d.coverEnd,
        inceptionDate: d.inceptionDate ?? null,
        sumInsured: money(d.sumInsured),
        sumInsuredAvailable: money(d.sumInsuredAvailable),
        verificationStatus: d.verificationStatus,
        sourceDocumentId,
      });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "coverage.added",
        resourceType: "patient",
        resourceId: p.patient.id,
        newState: { beneficiaryId: row.id, category: policy.category, ...auditView(d, policy.id) },
      });
      return row;
    });
  },

  /**
   * Corrects recorded coverage — typically after the insurance document arrives and the details can
   * be confirmed, or when a typed member ID turns out to be wrong. The policy may not be swapped once
   * a pre-authorization or claim has been raised on this coverage, because the policy is what decided
   * which payer received that request.
   */
  async update(ctx: ServiceContext, beneficiaryId: string, input: unknown) {
    requirePermission(ctx.principal, "policy:read");
    const scope = requirePermission(ctx.principal, "patient:write");
    const d = parseOrThrow(coverageInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const current = await CoverageRepository.findScoped(tx, ctx.principal, scope, requireId(beneficiaryId, "Coverage"));
      if (!current) throw new NotFoundError("Coverage not found.");
      const policy = await PolicyRepository.get(tx, d.policyId);
      if (!policy || !policy.isActive) throw new ValidationError("Select an available policy or scheme.", { policyId: ["Select a valid policy or scheme."] });
      if (policy.id !== current.policyId) {
        const used = await CoverageRepository.requestsUsing(tx, current.id);
        if (used.length) {
          throw new ConflictError(`This coverage is already used by ${used.join(", ")}, so its policy can't be changed. Add the correct policy as another coverage instead.`);
        }
      }
      if (d.memberId !== current.memberId && (await CoverageRepository.memberIdTaken(tx, policy.category, d.memberId, current.id))) {
        throw new ConflictError("This member / beneficiary ID is already recorded for another patient. Check the card for typing errors.");
      }
      const sourceDocumentId = await resolveSourceDocument(tx, ctx, current.patientId, d.sourceDocumentId);
      const row = await CoverageRepository.update(tx, current.id, {
        category: policy.category,
        policyId: policy.id,
        schemeId: policy.schemeId,
        memberId: d.memberId,
        policyNumber: d.policyNumber ?? null,
        policyholderName: d.policyholderName ?? null,
        relationship: d.relationship,
        coverStart: d.coverStart,
        coverEnd: d.coverEnd,
        inceptionDate: d.inceptionDate ?? null,
        sumInsured: money(d.sumInsured),
        sumInsuredAvailable: money(d.sumInsuredAvailable),
        verificationStatus: d.verificationStatus,
        sourceDocumentId: sourceDocumentId ?? current.sourceDocumentId,
      });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "coverage.updated",
        resourceType: "patient",
        resourceId: current.patientId,
        previousState: {
          beneficiaryId: current.id,
          policyId: current.policyId,
          memberId: current.memberId,
          relationship: current.relationship,
          coverStart: current.coverStart,
          coverEnd: current.coverEnd,
          inceptionDate: current.inceptionDate,
          verificationStatus: current.verificationStatus,
          sourceDocumentId: current.sourceDocumentId,
        },
        newState: { beneficiaryId: current.id, ...auditView(d, policy.id) },
      });
      return row;
    });
  },
};
