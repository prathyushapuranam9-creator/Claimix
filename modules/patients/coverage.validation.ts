import { z } from "zod";
import { zDate, zOptionalDate, zOptionalMoney, zUuid } from "@/lib/validation";

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

export const coverageInputSchema = z
  .object({
    policyId: zUuid,
    memberId: z.string().trim().min(3, "Enter the member / beneficiary ID.").max(80).regex(/^[A-Za-z0-9/_-]+$/, "Use letters, numbers, - / _ only."),
    relationship: z.enum(RELATIONSHIPS, { message: "Select the relationship." }),
    coverStart: zDate,
    coverEnd: zDate,
    inceptionDate: zOptionalDate,
    sumInsured: zOptionalMoney,
    sumInsuredAvailable: zOptionalMoney,
  })
  .superRefine((v, ctx) => {
    if (v.coverEnd < v.coverStart) ctx.addIssue({ code: "custom", path: ["coverEnd"], message: "End date must be after the start date." });
    if (v.inceptionDate && v.inceptionDate > v.coverStart) ctx.addIssue({ code: "custom", path: ["inceptionDate"], message: "First inception can't be after the current policy start." });
    if (v.sumInsured !== undefined && v.sumInsuredAvailable !== undefined && v.sumInsuredAvailable > v.sumInsured) {
      ctx.addIssue({ code: "custom", path: ["sumInsuredAvailable"], message: "Available balance can't exceed the sum insured." });
    }
  });

export type CoverageInput = z.input<typeof coverageInputSchema>;
