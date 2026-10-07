import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { can, scopeFor, type Principal } from "@/lib/permissions/principal";
import { parseOrThrow, todayIso } from "@/lib/validation";
import type { Outcome } from "@/modules/rules/engine/types";
import { CoverageService } from "@/modules/patients/coverage.service";
import { coverPeriodStatus, type CoverPeriodStatus } from "@/modules/patients/coverage.validation";
import { PatientService } from "@/modules/patients/patients.service";
import { resolveHospital, runEligibility } from "./eligibility.service";
import { failureReasons } from "./eligibility.sections";
import { eligibilityInputSchema } from "./eligibility.validation";

/** Statuses this check can actually produce. "Pending" is not one: the check runs synchronously. */
export type PatientEligibilityStatus = "eligible" | "not_eligible" | "expired" | "unable_to_verify";
export type CoverageStatus = CoverPeriodStatus;

export interface PatientEligibilityResult {
  patientId: string;
  patientName: string;
  patientNo: string;
  beneficiaryId: string;
  insurance: string | null;
  policyName: string;
  memberId: string;
  coverStart: string;
  coverEnd: string;
  coverageStatus: CoverageStatus;
  /** Whether the recorded details have been checked against the insurance document. */
  verificationStatus: "verified" | "requires_verification";
  status: PatientEligibilityStatus;
  /**
   * What the hospital can do next with this coverage: a pre-authorization or claim may only be
   * started while the cover period is in force. Computed here so the page cannot offer more.
   */
  canStartRequest: boolean;
  outcome: Outcome;
  /** Facts the rules needed but the record doesn't hold. */
  missingInformation: string[];
  /** Plain-language reasons from failed / unverified rules ("Rule title: message"), unique. */
  reasons: string[];
  evaluationId: string | null;
  checkedAt: string;
}

const STATUS: Record<Outcome, PatientEligibilityStatus> = { PASS: "eligible", FAIL: "not_eligible", NEEDS_VERIFICATION: "unable_to_verify" };

/** Insurer / TPA reviewers: may check coverage under their own organization's policies only. */
function isPayerReviewer(p: Principal) {
  return (p.orgType === "insurer" || p.orgType === "tpa") && (!!scopeFor(p, "preauth:review") || !!scopeFor(p, "claim:review"));
}

function payerOwns(p: Principal, cov: { insurerId: string | null; tpaId: string | null }) {
  return (p.orgType === "insurer" && cov.insurerId === p.organizationId) || (p.orgType === "tpa" && cov.tpaId === p.organizationId);
}

export const PatientEligibilityService = {
  /** Whether the profile offers the check at all (hospital staff and admins, or a payer reviewer). */
  canCheck(p: Principal) {
    return can(p, "eligibility:check") || (isPayerReviewer(p) && can(p, "patient:read"));
  },

  /** The coverage rows this user may check: all of them, or a payer's own policies only. */
  checkable<T extends { insurerId: string | null; tpaId: string | null }>(p: Principal, coverage: T[]): T[] {
    if (can(p, "eligibility:check")) return coverage;
    return isPayerReviewer(p) ? coverage.filter((c) => payerOwns(p, c)) : [];
  },

  /**
   * Runs the existing eligibility check for one recorded coverage of one patient.
   * The patient must be inside the caller's scope and the coverage must belong to that
   * patient — a coverage ID from another patient is "not found", never checked.
   * The check is for a cashless admission today; nothing else is assumed (missing facts
   * come back as "needs verification" from the rules engine).
   */
  async check(ctx: ServiceContext, patientId: string, beneficiaryId: string): Promise<PatientEligibilityResult> {
    const p = ctx.principal;
    if (!this.canCheck(p)) throw new ForbiddenError();
    const { patient } = await PatientService.get(ctx, patientId);
    const cov = await CoverageService.get(ctx, beneficiaryId);
    if (cov.patientId !== patient.id) throw new NotFoundError("Coverage not found.");
    if (!this.checkable(p, [cov]).length) throw new ForbiddenError("You can only check eligibility for your own organization's policies.");

    const today = todayIso();
    const d = parseOrThrow(eligibilityInputSchema, { beneficiaryId: cov.id, claimType: "cashless", admissionDate: today, hospitalId: patient.hospitalId });
    const scope = scopeFor(p, "eligibility:check");
    // Hospital staff: their own hospital; admins and payer reviewers: the patient's registering hospital.
    const out = await runEligibility(ctx, d, async () => (scope ? resolveHospital(ctx, scope, patient.hospitalId) : patient.hospitalId));

    const coverageStatus = coverPeriodStatus(cov, today);
    const overall = out.evaluation.overall;
    return {
      patientId: patient.id,
      patientName: patient.fullName,
      patientNo: patient.patientNo,
      beneficiaryId: cov.id,
      insurance: cov.category === "government" ? cov.schemeName : cov.insurerName,
      policyName: cov.policyName,
      memberId: cov.memberId,
      coverStart: cov.coverStart,
      coverEnd: cov.coverEnd,
      coverageStatus,
      verificationStatus: cov.verificationStatus,
      // An expired cover is reported as such rather than a generic "not eligible".
      status: coverageStatus === "expired" && overall !== "PASS" ? "expired" : STATUS[overall],
      canStartRequest: coverageStatus === "in_force" && overall !== "FAIL",
      outcome: overall,
      missingInformation: out.evaluation.missingInformation,
      reasons: failureReasons(out.evaluation.results),
      evaluationId: out.evaluationId,
      checkedAt: new Date().toISOString(),
    };
  },
};
