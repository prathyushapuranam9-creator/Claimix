import { z } from "zod";
import { caseDetailsShape } from "@/modules/eligibility/eligibility.validation";
import { zDate, zMoney, zOptionalDate, zOptionalMoney, zOptionalText, zOptionalUuid, zUuid } from "@/lib/validation";

/** Unselected radios / empty inputs arrive as null or "": treated as not given, so the wizard's own message shows. */
const blankChoice = (v: unknown) => (v === null || v === "" ? undefined : v);
const tenDigits = z.preprocess(blankChoice, z.string().trim().regex(/^\d{10}$/, "Enter a 10-digit number.").optional());
const hhmm = z.preprocess(blankChoice, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.").optional());

const clinicalShape = {
  symptoms: zOptionalText(2000),
  clinicalFindings: zOptionalText(2000),
  medicalHistory: zOptionalText(2000),
  investigationSummary: zOptionalText(2000),
  proposedTreatment: zOptionalText(2000),
  doctorName: zOptionalText(120),
  doctorRegistrationNo: zOptionalText(60),
  employeeId: zOptionalText(60),
  // New Claim wizard (Clinical Details & Package); free text kept with the other clinical notes.
  department: zOptionalText(60),
  familyPhysician: zOptionalText(120),
  criticalFindings: zOptionalText(2000),
  doctorContact: tenDigits,
  familyPhysicianContact: tenDigits,
  currentAddress: zOptionalText(300),
  occupation: zOptionalText(120),
  drugRoute: zOptionalText(60),
  presentAilmentHistory: zOptionalText(2000),
  admissionTime: hhmm,
  dischargeTime: hhmm,
};

/** Past history of chronic illness (IRDAI pre-authorization form). "None" excludes the others. */
export const CHRONIC_ILLNESSES = [
  "None", "Diabetes", "Heart disease", "Hypertension", "Hyperlipidemias", "Osteoarthritis", "Asthma / COPD / Bronchitis", "Cancer", "Alcohol / Drug abuse",
  "Any HIV or STD related ailment", "Any other ailment",
] as const;

/** Heads for the expected-cost breakdown. */
export const COST_HEADS = [
  "Room rent", "Nursing", "ICU", "Surgeon / OT charges", "Anaesthetist", "Consultant visits", "Investigations", "Medicines & consumables", "Implants", "Other",
] as const;

/** One head of the expected-cost breakdown: per-day rate × days. */
export const costItemSchema = z.object({
  head: z.enum(COST_HEADS, { message: "Choose a head." }),
  description: zOptionalText(200),
  perDay: zMoney,
  days: z.coerce.number({ message: "Enter the days." }).int("Whole numbers only.").min(1, "At least 1.").max(365),
});
export type CostItem = z.output<typeof costItemSchema>;

const nonNegInt = (max: number) => z.preprocess(blankChoice, z.coerce.number().int("Whole numbers only.").min(0).max(max).optional());

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
    treatmentType: z.preprocess(blankChoice, z.enum(["medical", "surgical"]).optional()),
    admissionType: z.preprocess(blankChoice, z.enum(["planned", "emergency"]).optional()),
    icuDays: nonNegInt(365),
    costItems: z.array(costItemSchema).max(50).optional(),
    /** All-inclusive package amount (empty when billed head by head); when given it is the expected cost. */
    packageAmount: zOptionalMoney,
    /** All diagnoses, primary first (the first is also stored as diagnosisId). */
    diagnosisIds: z.array(zUuid).max(10).optional(),
    dischargeDate: zOptionalDate,
    chronicIllness: z.array(z.enum(CHRONIC_ILLNESSES)).max(CHRONIC_ILLNESSES.length).optional(),
    ailmentDurationDays: nonNegInt(36500),
  })
  .superRefine((v, ctx) => {
    if (v.expectedInsuranceAmount !== undefined && v.estimatedCost !== undefined && v.expectedInsuranceAmount > v.estimatedCost) {
      ctx.addIssue({ code: "custom", path: ["expectedInsuranceAmount"], message: "Can't exceed the estimated cost." });
    }
    if (v.admissionDate && v.dischargeDate && `${v.dischargeDate}T${v.dischargeTime ?? "23:59"}` <= `${v.admissionDate}T${v.admissionTime ?? "00:00"}`) {
      ctx.addIssue({ code: "custom", path: ["dischargeDate"], message: "The stay must end after it starts." });
    }
    if (v.chronicIllness?.includes("None") && v.chronicIllness.length > 1) {
      ctx.addIssue({ code: "custom", path: ["chronicIllness"], message: "'None' can't be combined with an illness." });
    }
    if (v.pedDeclared === "no" && v.pedRelated === "yes") {
      ctx.addIssue({ code: "custom", path: ["pedRelated"], message: "No PED was declared, so this can't be PED-related." });
    }
  });

export const preauthCreateSchema = preauthDetailsSchema.and(z.object({ beneficiaryId: zUuid }));

/**
 * New Claim wizard, Clinical Details & Package: what a payer needs before the case is registered — on top of the
 * general rules. Checked on the server; the browser shows the same messages first.
 */
export const wizardClinicalSchema = preauthDetailsSchema.superRefine((v, ctx) => {
  const need = (ok: unknown, path: string, message: string) => !ok && ctx.addIssue({ code: "custom", path: [path], message });
  need(v.diagnosisIds?.length || v.diagnosisId, "diagnosisIds", "Add at least one diagnosis.");
  need(v.symptoms, "symptoms", "Describe the presenting complaint.");
  need(v.admissionDate, "admissionDate", "Enter when the stay starts.");
  need(v.dischargeDate, "dischargeDate", "Enter when the stay is expected to end.");
  need(v.doctorName, "doctorName", "Enter the treating doctor's name.");
  need(v.doctorContact, "doctorContact", "Enter the doctor's 10-digit contact number.");
  need(v.chronicIllness?.length, "chronicIllness", "Choose the past chronic illnesses, or None.");
  need(v.costItems?.length || v.packageAmount !== undefined, "costItems", "Add at least one cost head, or an all-inclusive package amount.");
});

/** Whole days between the stay's start and end (part days count as a day; at least 1); null when not both given. */
export function stayDays(start?: string, startTime?: string, end?: string, endTime?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(`${start}T${startTime || "00:00"}:00Z`);
  const b = Date.parse(`${end}T${endTime || "00:00"}:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.max(1, Math.ceil((b - a) / 86_400_000));
}

/** Expected cost: the all-inclusive package amount when given, otherwise the sum of the heads (per day × days). */
export function expectedCost(items: { perDay?: unknown; days?: unknown }[] | undefined, packageAmount: unknown): number | null {
  const pkg = packageAmount === "" || packageAmount === null || packageAmount === undefined ? NaN : Number(packageAmount);
  if (Number.isFinite(pkg)) return pkg;
  if (!items?.length) return null;
  const total = items.reduce((a, i) => a + (Number(i.perDay) || 0) * (Number(i.days) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Step 1 (KYC & Policy): what the reviewer typed, or confirmed after reading the patient's ID and policy card. */
export const wizardKycSchema = z
  .object({
    uhid: zOptionalText(60),
    patientName: z.string().trim().min(2, "Enter the patient's name.").max(120),
    gender: z.enum(["male", "female", "other"], { message: "Select the gender." }),
    dob: zDate,
    mobile: z.string({ message: "Enter a 10-digit mobile number." }).trim().regex(/^\d{10}$/, "Enter a 10-digit mobile number."),
    insurerId: zUuid,
    tpaId: zOptionalUuid,
    policyNumber: z.string({ message: "Enter the policy number." }).trim().min(2, "Enter the policy number.").max(80),
    policyFrom: zDate,
    policyTo: zDate,
    sumInsured: zOptionalMoney,
    memberId: zOptionalText(80),
    /** How the details were captured: read from the uploaded card, or typed. */
    mode: z.enum(["document", "typed"]).default("typed"),
  })
  .superRefine((v, ctx) => {
    if (v.policyTo < v.policyFrom) ctx.addIssue({ code: "custom", path: ["policyTo"], message: "Must be on or after Policy From." });
  });
export type WizardKycInput = z.input<typeof wizardKycSchema>;
export type WizardKyc = z.output<typeof wizardKycSchema>;

/** Step 1 → a draft case: the member found on record (or identified by a unique member ID) and the KYC. */
export const wizardRaiseSchema = z.object({ beneficiaryId: zOptionalUuid, kyc: wizardKycSchema });

/** Submit step: the reviewer acknowledges the unresolved gaps (required whenever there are any). */
export function gapsAcknowledgment(n: number): string {
  return `I have seen ${n === 1 ? "this 1 gap" : `these ${n} gaps`} and am sending anyway. This is written to the case audit trail with the submission.`;
}
export const wizardSubmitSchema = z.object({ acknowledged: z.boolean().default(false) });

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
