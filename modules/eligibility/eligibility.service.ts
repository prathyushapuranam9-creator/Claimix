import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { diagnoses, organizations, procedures } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId, todayIso } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { HospitalRepository, networkForPolicy } from "@/modules/hospitals/hospitals.repository";
import { CoverageRepository } from "@/modules/patients/coverage.repository";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import type { CaseFacts, Evaluation } from "@/modules/rules/engine/types";
import { RuleRepository } from "@/modules/rules/rules.repository";
import { evaluateAndRecord, loadEvaluation } from "@/modules/rules/rules.service";
import type { z } from "zod";
import { eligibilityInputSchema, fromTriState } from "./eligibility.validation";

const num = (v: string | null | undefined) => (v === null || v === undefined ? undefined : Number(v));

async function codeOf(db: DbOrTx, table: typeof diagnoses | typeof procedures, id: string | undefined, field: string) {
  if (!id) return undefined;
  const [row] = await db.select({ code: table.code }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new ValidationError("Select a valid option.", { [field]: ["Select a valid option."] });
  return row.code;
}

/** Resolves the hospital the check is for: always the caller's own hospital unless a platform admin chooses one. */
export async function resolveHospital(ctx: ServiceContext, scope: string, requested: string | undefined) {
  if (ctx.principal.orgType === "hospital") return ctx.principal.organizationId;
  if (scope === "all") {
    if (!requested) throw new ValidationError("Select the hospital.", { hospitalId: ["Select the hospital."] });
    if (!(await HospitalRepository.exists(ctx.db, requested))) throw new ValidationError("Select a valid hospital.", { hospitalId: ["Select a valid hospital."] });
    return requested;
  }
  throw new ForbiddenError();
}

export interface EligibilityOutcome {
  evaluation: Evaluation;
  evaluationId: string | null;
  ruleVersion: number | null;
  policy: { id: string; name: string; category: "private" | "government" };
  hospital: { id: string; name: string; networkStatus: string | null; lastVerifiedAt: string | null };
  beneficiaryId: string | null;
  facts: CaseFacts;
}

/** A previously recorded eligibility check, replayed from its stored rule version and input snapshot. */
export interface EligibilityHistoryItem {
  id: string;
  evaluatedAt: Date;
  overall: Evaluation["overall"];
  ruleVersion: number;
  policyName: string;
  hospitalName: string;
  checkedBy: string | null;
  /** Case details that were checked (from the stored input snapshot). */
  case: { claimType?: string; admissionDate?: string; diagnosisCode?: string; procedureCode?: string; estimatedCost?: number };
  evaluation: Evaluation;
}

const HISTORY_LIMIT = 10;

export const EligibilityService = {
  /**
   * Previous eligibility checks for a coverage the caller may see, newest first. Reads recorded
   * evaluations only — it never runs the check again. Tenant users only get checks run by their own
   * organization; platform admins see all.
   */
  async history(ctx: ServiceContext, beneficiaryId: string): Promise<EligibilityHistoryItem[]> {
    const scope = requirePermission(ctx.principal, "eligibility:check");
    const cov = await CoverageRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "patient:read"), requireId(beneficiaryId, "Coverage"));
    if (!cov) throw new NotFoundError("Coverage not found.");
    const rows = await RuleRepository.evaluationsForSubject(ctx.db, "eligibility_check", cov.id, scope === "all" ? undefined : ctx.principal.organizationId, HISTORY_LIMIT);
    const items: EligibilityHistoryItem[] = [];
    for (const r of rows) {
      const loaded = await loadEvaluation(ctx.db, r.id);
      if (!loaded) continue;
      const f = r.inputSnapshot as Partial<CaseFacts>;
      items.push({
        id: r.id,
        evaluatedAt: r.evaluatedAt,
        overall: r.overall,
        ruleVersion: r.ruleVersion,
        policyName: r.policyName,
        hospitalName: r.hospitalName,
        checkedBy: r.checkedBy,
        case: { claimType: f.claimType, admissionDate: f.admissionDate, diagnosisCode: f.diagnosisCode, procedureCode: f.procedureCode, estimatedCost: f.estimatedCost },
        evaluation: loaded.evaluation,
      });
    }
    return items;
  },

  /** Latest check per coverage, for the coverage list on a patient page. Empty for users who can't run checks. */
  async latestChecks(ctx: ServiceContext, beneficiaryIds: string[]) {
    if (!ctx.principal.permissions.has("eligibility:check")) return new Map<string, { id: string; evaluatedAt: Date; overall: Evaluation["overall"] }>();
    const scope = requirePermission(ctx.principal, "eligibility:check");
    const rows = await RuleRepository.latestForSubjects(ctx.db, "eligibility_check", beneficiaryIds, scope === "all" ? undefined : ctx.principal.organizationId);
    return new Map(rows.map((r) => [r.subjectId!, { id: r.id, evaluatedAt: r.evaluatedAt, overall: r.overall }]));
  },

  /**
   * Runs the policy's own active rules against the case. Recorded coverage is the
   * source of truth when a beneficiary is given; nothing missing is ever assumed.
   */
  async check(ctx: ServiceContext, input: unknown): Promise<EligibilityOutcome> {
    const scope = requirePermission(ctx.principal, "eligibility:check");
    const d = parseOrThrow(eligibilityInputSchema, input);
    return runEligibility(ctx, d, () => resolveHospital(ctx, scope, d.hospitalId));
  },
};

/**
 * The check itself, shared by the eligibility checker and the patient profile. Callers
 * authorize first and decide which hospital the check is for; nothing here widens access
 * (recorded coverage is still loaded only inside the caller's patient scope).
 */
export async function runEligibility(ctx: ServiceContext, d: z.output<typeof eligibilityInputSchema>, hospitalFor: () => Promise<string>): Promise<EligibilityOutcome> {
  let policyId = d.policyId;
  let cover: CaseFacts["cover"];
  let patient: CaseFacts["patient"];
  if (d.beneficiaryId) {
    const cov = await CoverageRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "patient:read"), d.beneficiaryId);
    if (!cov) throw new NotFoundError("Coverage not found.");
    policyId = cov.policyId!;
    patient = { dob: cov.patient.dob, relationship: cov.relationship };
    cover = { start: cov.coverStart, end: cov.coverEnd, inceptionDate: cov.inceptionDate ?? undefined, sumInsured: num(cov.sumInsured), availableBalance: num(cov.sumInsuredAvailable) };
  } else {
    patient = { dob: d.dob, relationship: d.relationship };
    cover = { start: d.coverStart, end: d.coverEnd, inceptionDate: d.inceptionDate, sumInsured: d.sumInsured, availableBalance: d.availableBalance };
  }

  const policy = await PolicyRepository.get(ctx.db, policyId!);
  if (!policy) throw new ValidationError("Select a valid policy or scheme.", { policyId: ["Select a valid policy or scheme."] });
  const hospitalId = await hospitalFor();
  const [net, [hosp], dxCode, pxCode] = await Promise.all([
    networkForPolicy(ctx.db, hospitalId, policy),
    ctx.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, hospitalId)),
    codeOf(ctx.db, diagnoses, d.diagnosisId, "diagnosisId"),
    codeOf(ctx.db, procedures, d.procedureId, "procedureId"),
  ]);

  const facts: CaseFacts = {
    stage: "eligibility",
    asOf: todayIso(),
    claimType: d.claimType,
    patient,
    cover,
    admissionDate: d.admissionDate,
    hospital: { networkStatus: net?.status ?? null, cashlessAvailable: net?.cashlessAvailable ?? false, lastVerifiedAt: net?.lastVerifiedAt?.toISOString() ?? null },
    diagnosisCode: dxCode,
    procedureCode: pxCode,
    isAccident: fromTriState(d.isAccident),
    ped: { declared: fromTriState(d.pedDeclared), related: fromTriState(d.pedRelated) },
    estimatedCost: d.estimatedCost,
    roomRentPerDay: d.roomRentPerDay,
  };

  return ctx.db.transaction(async (tx) => {
    const res = await evaluateAndRecord(tx, ctx, { policyId: policy.id, subjectType: "eligibility_check", subjectId: d.beneficiaryId, facts });
    await AuditService.record(tx, {
      ...actorOf(ctx),
      action: "eligibility.checked",
      resourceType: d.beneficiaryId ? "beneficiary" : "policy",
      resourceId: d.beneficiaryId ?? policy.id,
      newState: { policyId: policy.id, hospitalId, overall: res.evaluation.overall, evaluationId: res.evaluationId },
    });
    return {
      ...res,
      policy: { id: policy.id, name: policy.name, category: policy.category },
      hospital: { id: hospitalId, name: hosp?.name ?? "", networkStatus: net?.status ?? null, lastVerifiedAt: net?.lastVerifiedAt?.toISOString() ?? null },
      beneficiaryId: d.beneficiaryId ?? null,
      facts,
    };
  });
}
