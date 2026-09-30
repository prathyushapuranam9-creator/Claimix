import { z } from "zod";
import { caseDetailsShape } from "@/modules/eligibility/eligibility.validation";
import { zMoney, zOptionalMoney, zOptionalText, zOptionalUuid, zUuid } from "@/lib/validation";

const clinicalShape = {
  symptoms: zOptionalText(2000),
  clinicalFindings: zOptionalText(2000),
  medicalHistory: zOptionalText(2000),
  investigationSummary: zOptionalText(2000),
  proposedTreatment: zOptionalText(2000),
  doctorName: zOptionalText(120),
  doctorRegistrationNo: zOptionalText(60),
  employeeId: zOptionalText(60),
};

export const CLINICAL_FIELDS = Object.keys(clinicalShape) as (keyof typeof clinicalShape)[];

export const preauthDetailsSchema = z
  .object({
    ...caseDetailsShape,
    ...clinicalShape,
    packageId: zOptionalUuid,
    expectedStayDays: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1, "At least 1 day.").max(365).optional()),
    roomCategory: zOptionalText(60),
    expectedInsuranceAmount: zOptionalMoney,
    patientContribution: zOptionalMoney,
  })
  .superRefine((v, ctx) => {
    if (v.expectedInsuranceAmount !== undefined && v.estimatedCost !== undefined && v.expectedInsuranceAmount > v.estimatedCost) {
      ctx.addIssue({ code: "custom", path: ["expectedInsuranceAmount"], message: "Can't exceed the estimated cost." });
    }
    if (v.pedDeclared === "no" && v.pedRelated === "yes") {
      ctx.addIssue({ code: "custom", path: ["pedRelated"], message: "No PED was declared, so this can't be PED-related." });
    }
  });

export const preauthCreateSchema = preauthDetailsSchema.and(z.object({ beneficiaryId: zUuid }));

export type PreauthDetailsInput = z.input<typeof preauthDetailsSchema>;
export type PreauthCreateInput = z.input<typeof preauthCreateSchema>;

export const confirmItemSchema = z.object({
  key: z.string().max(60),
  confirmed: z.boolean(),
  note: zOptionalText(500),
});

export const submitSchema = z.object({
  overrideReason: zOptionalText(1000),
});

/** Payer decisions (and scheme-desk recordings of a scheme's decision). */
export const decisionSchema = z
  .object({
    to: z.enum(["pending", "query", "approved", "partially_approved", "rejected", "final_approved", "settled"]),
    reasonId: zOptionalUuid,
    message: zOptionalText(2000),
    amount: z.preprocess((v) => (v === "" ? undefined : v), zMoney.optional()),
    requiredDocuments: z.array(z.string().regex(/^[a-z0-9_]+$/).max(60)).max(30).default([]),
    payerReference: zOptionalText(100),
  })
  .superRefine((v, ctx) => {
    if ((v.to === "rejected" || v.to === "query") && !v.reasonId) ctx.addIssue({ code: "custom", path: ["reasonId"], message: "Select a reason." });
    if ((v.to === "rejected" || v.to === "query" || v.to === "partially_approved") && (!v.message || v.message.length < 10)) {
      ctx.addIssue({ code: "custom", path: ["message"], message: "Explain the decision (at least 10 characters)." });
    }
    if (["approved", "partially_approved", "final_approved"].includes(v.to) && (v.amount === undefined || v.amount <= 0)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the approved amount." });
    }
  });

export type DecisionInput = z.input<typeof decisionSchema>;

export const queryResponseSchema = z.object({
  message: z.string().trim().min(10, "Describe what was provided (at least 10 characters).").max(2000),
});

export const cancelSchema = z.object({ message: z.string().trim().min(5, "Give a short reason.").max(1000) });
