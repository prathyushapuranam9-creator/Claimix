import { z } from "zod";
import { zDate, zOptionalDate, zOptionalMoney, zOptionalText, zOptionalUuid, zUuid } from "@/lib/validation";

export const RELATIONSHIPS = ["self", "spouse", "child", "parent", "parent_in_law", "sibling", "other"] as const;

export const RELATIONSHIP_LABEL: Record<(typeof RELATIONSHIPS)[number], string> = {
  self: "Self (policyholder)",
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  parent_in_law: "Parent-in-law",
  sibling: "Sibling",
  other: "Other",
};

/**
 * Whether the recorded details were checked against the insurance card / policy document. Coverage can
 * always be saved without the document; it is then recorded as still needing verification.
 */
export const COVERAGE_VERIFICATION = ["verified", "requires_verification"] as const;

export type CoverageVerification = (typeof COVERAGE_VERIFICATION)[number];

export const VERIFICATION_LABEL: Record<CoverageVerification, string> = {
  verified: "Verified against the insurance document",
  requires_verification: "Requires verification",
};

export const coverageInputSchema = z
  .object({
    policyId: zUuid,
    memberId: z.string().trim().min(3, "Enter the member / beneficiary ID.").max(80).regex(/^[A-Za-z0-9/_-]+$/, "Use letters, numbers, - / _ only."),
    /** Printed on most policy documents alongside, and often differently from, the member ID. */
    policyNumber: zOptionalText(80).refine((v) => v === undefined || /^[A-Za-z0-9/_. -]+$/.test(v), "Use letters, numbers, spaces and - / _ . only."),
    /** Who the policy is held by, when that is not the patient. */
    policyholderName: zOptionalText(200),
    relationship: z.enum(RELATIONSHIPS, { message: "Select the relationship." }),
    coverStart: zDate,
    coverEnd: zDate,
    inceptionDate: zOptionalDate,
    sumInsured: zOptionalMoney,
    sumInsuredAvailable: zOptionalMoney,
    /** Defaults to "requires verification": nothing counts as confirmed unless staff say so. */
    verificationStatus: z.preprocess((v) => (v === "" || v === undefined ? "requires_verification" : v), z.enum(COVERAGE_VERIFICATION, { message: "Choose whether the details are verified." })),
    /** The patient's insurance document these details were read from, when there was one. */
    sourceDocumentId: zOptionalUuid,
  })
  .superRefine((v, ctx) => {
    if (v.coverEnd < v.coverStart) ctx.addIssue({ code: "custom", path: ["coverEnd"], message: "End date must be after the start date." });
    if (v.inceptionDate && v.inceptionDate > v.coverStart) ctx.addIssue({ code: "custom", path: ["inceptionDate"], message: "First inception can't be after the current policy start." });
    if (v.sumInsured !== undefined && v.sumInsuredAvailable !== undefined && v.sumInsuredAvailable > v.sumInsured) {
      ctx.addIssue({ code: "custom", path: ["sumInsuredAvailable"], message: "Available balance can't exceed the sum insured." });
    }
  });

export type CoverageInput = z.input<typeof coverageInputSchema>;

/** Where a cover period sits relative to a date: the plain calendar fact, with no rules involved. */
export type CoverPeriodStatus = "in_force" | "expired" | "not_started";

export const COVER_PERIOD_LABEL: Record<CoverPeriodStatus, string> = {
  in_force: "In force",
  expired: "Expired",
  not_started: "Not started",
};

export function coverPeriodStatus(cover: { coverStart: string; coverEnd: string }, on: string): CoverPeriodStatus {
  if (cover.coverEnd < on) return "expired";
  if (cover.coverStart > on) return "not_started";
  return "in_force";
}
