import { z } from "zod";
import { RELATIONSHIPS } from "@/modules/patients/coverage.validation";
import { zOptionalDate, zOptionalMoney, zOptionalUuid } from "@/lib/validation";

const blank = (v: unknown) => (v === "" ? undefined : v);
export const triState = z.preprocess(blank, z.enum(["yes", "no", "unknown"]).optional());

/** "yes" / "no" → boolean; "unknown" or absent → undefined (the engine then asks for verification). */
export function fromTriState(v: "yes" | "no" | "unknown" | undefined): boolean | undefined {
  return v === "yes" ? true : v === "no" ? false : undefined;
}

/** Case details shared by the eligibility checker and pre-authorization. */
export const caseDetailsShape = {
  claimType: z.enum(["cashless", "reimbursement"], { message: "Choose cashless or reimbursement." }),
  diagnosisId: zOptionalUuid,
  procedureId: zOptionalUuid,
  admissionDate: zOptionalDate,
  isAccident: triState,
  pedDeclared: triState,
  pedRelated: triState,
  estimatedCost: zOptionalMoney,
  roomRentPerDay: zOptionalMoney,
};

export const eligibilityInputSchema = z
  .object({
    /** Recorded coverage: when present, member, dates and balance come from the database. */
    beneficiaryId: zOptionalUuid,
    policyId: zOptionalUuid,
    memberId: z.preprocess(blank, z.string().trim().max(80).optional()),
    dob: zOptionalDate,
    relationship: z.preprocess(blank, z.enum(RELATIONSHIPS).optional()),
    coverStart: zOptionalDate,
    coverEnd: zOptionalDate,
    inceptionDate: zOptionalDate,
    sumInsured: zOptionalMoney,
    availableBalance: zOptionalMoney,
    hospitalId: zOptionalUuid,
    ...caseDetailsShape,
  })
  .superRefine((v, ctx) => {
    if (!v.beneficiaryId && !v.policyId) ctx.addIssue({ code: "custom", path: ["policyId"], message: "Select the insurance policy or scheme." });
  });

export type EligibilityInput = z.input<typeof eligibilityInputSchema>;
