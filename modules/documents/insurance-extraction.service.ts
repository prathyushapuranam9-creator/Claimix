import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { PatientRepository } from "@/modules/patients/patients.repository";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import { documentLabel, isInsuranceDocumentType } from "./document-types";
import { DocumentRepository } from "./documents.repository";
import { documentText, matchPolicy, parseInsuranceDetails, type PolicyOption, type Relationship } from "./insurance-extraction";
import { getStorage } from "./storage";

/** Pre-fill for the Add coverage form. Every key is optional: what the document doesn't say stays blank. */
export interface CoverageSuggestion {
  policyId?: string;
  memberId?: string;
  policyNumber?: string;
  policyholderName?: string;
  relationship?: Relationship;
  inceptionDate?: string;
  coverStart?: string;
  coverEnd?: string;
  sumInsured?: string;
  sumInsuredAvailable?: string;
}

export interface InsuranceExtraction {
  documentId: string;
  documentType: string;
  documentLabel: string;
  originalName: string;
  values: CoverageSuggestion;
  /** What was read, with the label it came from, for staff to check against the document. */
  read: { label: string; value: string; from: string }[];
  /**
   * Names printed on the document. They are not coverage fields, so they are never saved here, but a
   * name that differs from the patient's registered name is a common cause of payer queries.
   */
  namesOnDocument: { label: string; value: string }[];
  /** Coverage fields the document did not give; staff type these in. */
  missing: string[];
  /** The matched Claimix policy, when the document named one unambiguously. */
  matchedPolicy: { id: string; name: string } | null;
  /** True when the file carries no text layer at all (a photo or scan without OCR). */
  noReadableText: boolean;
}

const FORM_FIELDS: [keyof CoverageSuggestion, string][] = [
  ["policyId", "Policy / scheme"],
  ["memberId", "Member / beneficiary ID"],
  ["policyNumber", "Policy number"],
  ["policyholderName", "Policyholder"],
  ["relationship", "Relationship to policyholder"],
  ["inceptionDate", "First inception date"],
  ["coverStart", "Cover start"],
  ["coverEnd", "Cover end"],
  ["sumInsured", "Sum insured"],
  ["sumInsuredAvailable", "Available balance"],
];

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export const InsuranceExtractionService = {
  /**
   * Reads what it can from one of the patient's insurance documents and offers it as a pre-fill for
   * the coverage form. It writes nothing: the staff member reviews and edits every value, and only
   * the submitted form becomes coverage. Fields the document does not state are reported as missing
   * rather than filled with a guess, and the policy is only pre-selected on an unambiguous match
   * (the policy decides the payer, so a wrong guess would route the request to the wrong insurer).
   */
  async fromDocument(ctx: ServiceContext, patientId: string, documentId: string): Promise<InsuranceExtraction> {
    const scope = requirePermission(ctx.principal, "document:read");
    requirePermission(ctx.principal, "patient:write");
    const found = await PatientRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "patient:read"), requireId(patientId, "Patient"));
    if (!found) throw new NotFoundError("Patient not found.");
    const doc = await DocumentRepository.findScoped(ctx.db, ctx.principal, scope, requireId(documentId, "Document"));
    // A document of another patient is "not found", never read.
    if (!doc || doc.patientId !== found.patient.id) throw new NotFoundError("Document not found.");
    if (doc.subjectId || !isInsuranceDocumentType(doc.docType)) {
      throw new ValidationError("Only the patient's insurance card, policy copy or scheme enrolment document can be read for coverage details.");
    }
    if (doc.scanStatus !== "clean") throw new ForbiddenError("This document is not available until its security scan has passed.");

    const text = documentText(await getStorage().get(doc.storageKey));
    const parsed = parseInsuranceDetails(text);
    const options = (await PolicyRepository.options(ctx.db, undefined, { principal: ctx.principal, scope: requirePermission(ctx.principal, "policy:read") })) as PolicyOption[];
    const match = matchPolicy(text, options);

    const d = parsed.details;
    const values: CoverageSuggestion = {
      ...(match ? { policyId: match.policy.id } : {}),
      // The member ID is required, so a document that prints only a policy number offers that as the
      // candidate; both fields are shown and either can be corrected before saving.
      ...(d.memberId ?? d.policyNumber ? { memberId: d.memberId ?? d.policyNumber } : {}),
      ...(d.policyNumber ? { policyNumber: d.policyNumber } : {}),
      ...(d.policyHolderName ? { policyholderName: d.policyHolderName } : {}),
      ...(d.relationship ? { relationship: d.relationship } : {}),
      ...(d.inceptionDate ? { inceptionDate: d.inceptionDate } : {}),
      ...(d.coverStart ? { coverStart: d.coverStart } : {}),
      ...(d.coverEnd ? { coverEnd: d.coverEnd } : {}),
      ...(d.sumInsured !== undefined ? { sumInsured: money(d.sumInsured) } : {}),
      ...(d.availableBalance !== undefined ? { sumInsuredAvailable: money(d.availableBalance) } : {}),
    };

    // The policyholder now has a coverage field of its own; only the patient/member name on the card
    // stays purely informational (it is checked against the registered patient, never saved).
    const NAME_FIELDS = ["patientName"] as const;
    const read = parsed.read
      .filter((r) => !(NAME_FIELDS as readonly string[]).includes(r.field))
      .map((r) => ({ label: r.label, value: String(d[r.field] ?? ""), from: r.raw }));
    const namesOnDocument = parsed.read
      .filter((r) => (NAME_FIELDS as readonly string[]).includes(r.field))
      .map((r) => ({ label: r.label, value: String(d[r.field] ?? "") }));
    if (match) read.unshift({ label: "Policy / scheme", value: match.policy.name, from: d.policyName ?? d.insurerName ?? d.schemeName ?? match.policy.name });

    await AuditService.record(ctx.db, {
      ...actorOf(ctx),
      action: "coverage.details_extracted",
      resourceType: "document",
      resourceId: doc.id,
      newState: { patientId: found.patient.id, fields: Object.keys(values), matchedPolicyId: match?.policy.id ?? null, readableText: parsed.hasText },
    });

    return {
      documentId: doc.id,
      documentType: doc.docType,
      documentLabel: documentLabel(doc.docType),
      originalName: doc.originalName,
      values,
      read,
      namesOnDocument,
      missing: FORM_FIELDS.filter(([k]) => values[k] === undefined).map(([, label]) => label),
      matchedPolicy: match ? { id: match.policy.id, name: match.policy.name } : null,
      noReadableText: !parsed.hasText,
    };
  },
};
