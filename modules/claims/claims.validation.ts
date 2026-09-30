import { z } from "zod";
import { triState } from "@/modules/eligibility/eligibility.validation";
import { todayIso, zDate, zMoney, zOptionalDate, zOptionalMoney, zOptionalText, zOptionalUuid, zUuid } from "@/lib/validation";

export const claimDetailsSchema = z
  .object({
    diagnosisId: zOptionalUuid,
    procedureId: zOptionalUuid,
    admissionDate: zOptionalDate,
    dischargeDate: zOptionalDate,
    billNumber: zOptionalText(60),
    claimedAmount: zOptionalMoney,
    roomRentPerDay: zOptionalMoney,
    isAccident: triState,
    pedDeclared: triState,
    pedRelated: triState,
    finalDiagnosisNotes: zOptionalText(2000),
    treatmentGiven: zOptionalText(2000),
    nonPayableNotes: zOptionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.admissionDate && v.dischargeDate && v.dischargeDate < v.admissionDate) {
      ctx.addIssue({ code: "custom", path: ["dischargeDate"], message: "Discharge can't be before admission." });
    }
    if (v.dischargeDate && v.dischargeDate > todayIso()) {
      ctx.addIssue({ code: "custom", path: ["dischargeDate"], message: "A final claim is filed after discharge; the date can't be in the future." });
    }
  });

export const cashlessClaimSchema = claimDetailsSchema.and(z.object({ preAuthId: zUuid }));
export const reimbursementClaimSchema = claimDetailsSchema.and(z.object({ beneficiaryId: zUuid }));

export type ClaimDetailsInput = z.input<typeof claimDetailsSchema>;
export type CashlessClaimInput = z.input<typeof cashlessClaimSchema>;
export type ReimbursementClaimInput = z.input<typeof reimbursementClaimSchema>;

export const claimDecisionSchema = z
  .object({
    to: z.enum(["pending", "query", "approved", "partially_approved", "rejected"]),
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
    if ((v.to === "approved" || v.to === "partially_approved") && (v.amount === undefined || v.amount <= 0)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the approved amount." });
    }
  });

export type ClaimDecisionInput = z.input<typeof claimDecisionSchema>;

export const settlementSchema = z.object({
  amount: zMoney.refine((n) => n > 0, "Enter the amount paid."),
  utr: z.string().trim().min(6, "Enter the payment reference (UTR / cheque no.).").max(60).regex(/^[A-Za-z0-9/-]+$/, "Use letters, numbers, - and / only."),
  settledAt: zDate.refine((v) => v <= todayIso(), "Payment date can't be in the future."),
  deductionNote: zOptionalText(1000),
});

export type SettlementInput = z.input<typeof settlementSchema>;

export const CLAIM_CLINICAL_FIELDS = ["finalDiagnosisNotes", "treatmentGiven", "nonPayableNotes"] as const;
