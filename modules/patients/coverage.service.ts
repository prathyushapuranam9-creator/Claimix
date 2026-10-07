import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import { CoverageRepository } from "./coverage.repository";
import { coverageInputSchema } from "./coverage.validation";
import { PatientRepository } from "./patients.repository";

const money = (n: number | undefined) => (n === undefined ? null : n.toFixed(2));

export const CoverageService = {
  async forPatient(ctx: ServiceContext, patientId: string) {
    const scope = requirePermission(ctx.principal, "patient:read");
    const p = await PatientRepository.findScoped(ctx.db, ctx.principal, scope, requireId(patientId, "Patient"));
    if (!p) throw new NotFoundError("Patient not found.");
    const rows = await CoverageRepository.forPatient(ctx.db, patientId);
    // Narrowed to one policy (insurance testing context): only that policy's coverage.
    return ctx.principal.policyId ? rows.filter((r) => r.policyId === ctx.principal.policyId) : rows;
  },

  async get(ctx: ServiceContext, beneficiaryId: string) {
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

  /** Records a patient's policy or scheme enrolment exactly as shown on the card / scheme record. */
  async add(ctx: ServiceContext, patientId: string, input: unknown) {
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
      const row = await CoverageRepository.insert(tx, {
        patientId,
        category: policy.category,
        policyId: policy.id,
        schemeId: policy.schemeId,
        memberId: d.memberId,
        relationship: d.relationship,
        coverStart: d.coverStart,
        coverEnd: d.coverEnd,
        inceptionDate: d.inceptionDate ?? null,
        sumInsured: money(d.sumInsured),
        sumInsuredAvailable: money(d.sumInsuredAvailable),
      });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "coverage.added",
        resourceType: "patient",
        resourceId: patientId,
        newState: { beneficiaryId: row.id, policyId: policy.id, category: policy.category, relationship: d.relationship, coverStart: d.coverStart, coverEnd: d.coverEnd },
      });
      return row;
    });
  },
};
