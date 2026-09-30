import { z } from "zod";
import { zName, zOptionalMoney, zOptionalText, zOptionalUuid } from "@/lib/validation";

export const PRIVATE_PRODUCT_TYPES = {
  individual: "Individual health insurance",
  family_floater: "Family floater",
  group: "Group / corporate",
  senior_citizen: "Senior citizen",
  critical_illness: "Critical illness",
  hospital_daily_cash: "Hospital daily cash",
  top_up: "Top-up",
  super_top_up: "Super top-up",
  personal_accident: "Personal accident",
  disease_specific: "Disease-specific",
} as const;

export const GOVERNMENT_PRODUCT_TYPES = {
  central_scheme: "Central government scheme",
  state_scheme: "State government scheme",
  employee_scheme: "Government employee scheme",
} as const;

export const PRODUCT_TYPE_LABEL: Record<string, string> = { ...PRIVATE_PRODUCT_TYPES, ...GOVERNMENT_PRODUCT_TYPES };

/** Descriptive, non-decisional text shown on policy tabs. Decisions come only from rules. */
export const POLICY_INFO_FIELDS = {
  eligibilityNotes: "Eligibility notes",
  beneficiaryVerification: "Beneficiary / member verification",
  cashless: "Cashless process",
  reimbursement: "Reimbursement process",
  preauthProcess: "Pre-authorization process",
  claimProcess: "Claim process",
  packageRules: "Package rules",
  patientResponsibilities: "Patient responsibilities",
  renewal: "Renewal information",
  contact: "Contact information",
} as const;

export type PolicyInfoKey = keyof typeof POLICY_INFO_FIELDS;
export type PolicyInfo = Partial<Record<PolicyInfoKey, string>>;

const infoShape = Object.fromEntries(Object.keys(POLICY_INFO_FIELDS).map((k) => [k, zOptionalText(4000)])) as Record<PolicyInfoKey, ReturnType<typeof zOptionalText>>;

export const policyInputSchema = z
  .object({
    category: z.enum(["private", "government"], { message: "Choose private insurance or government scheme." }),
    insurerId: zOptionalUuid,
    tpaId: zOptionalUuid,
    schemeId: zOptionalUuid,
    name: zName,
    productType: z.string().refine((v) => v in PRODUCT_TYPE_LABEL, "Select a product type."),
    sumInsuredMin: zOptionalMoney,
    sumInsuredMax: zOptionalMoney,
    summary: zOptionalText(2000),
    ...infoShape,
  })
  .superRefine((v, ctx) => {
    // Private policies and government schemes never mix.
    if (v.category === "private") {
      if (!v.insurerId) ctx.addIssue({ code: "custom", path: ["insurerId"], message: "Select the insurer." });
      if (v.schemeId) ctx.addIssue({ code: "custom", path: ["schemeId"], message: "Private policies can't be linked to a scheme." });
      if (!(v.productType in PRIVATE_PRODUCT_TYPES)) ctx.addIssue({ code: "custom", path: ["productType"], message: "Choose a private insurance product type." });
    } else {
      if (!v.schemeId) ctx.addIssue({ code: "custom", path: ["schemeId"], message: "Select the government scheme." });
      if (v.insurerId) ctx.addIssue({ code: "custom", path: ["insurerId"], message: "Scheme covers aren't issued by a private insurer here." });
      if (!(v.productType in GOVERNMENT_PRODUCT_TYPES)) ctx.addIssue({ code: "custom", path: ["productType"], message: "Choose a government scheme type." });
    }
    if (v.sumInsuredMin !== undefined && v.sumInsuredMax !== undefined && v.sumInsuredMin > v.sumInsuredMax) {
      ctx.addIssue({ code: "custom", path: ["sumInsuredMax"], message: "Maximum must be at least the minimum." });
    }
  });

export type PolicyInput = z.input<typeof policyInputSchema>;

export function pickInfo(v: Record<string, unknown>): PolicyInfo {
  const out: PolicyInfo = {};
  for (const k of Object.keys(POLICY_INFO_FIELDS) as PolicyInfoKey[]) {
    if (typeof v[k] === "string" && v[k]) out[k] = v[k] as string;
  }
  return out;
}
