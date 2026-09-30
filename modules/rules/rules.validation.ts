import { z } from "zod";
import { zDate } from "@/lib/validation";

export const RULE_CATEGORIES = ["eligibility", "coverage", "waiting_period", "ped", "exclusion", "limit", "document", "preauth", "claim"] as const;

export const ruleInputSchema = z.object({
  category: z.enum(RULE_CATEGORIES, { message: "Select a category." }),
  kind: z.string().min(1, "Select a rule type.").max(60),
  code: z.string().trim().min(2, "Enter a short code.").max(80).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores."),
  title: z.string().trim().min(2, "Enter a title.").max(200),
  /** Kind-specific settings as JSON text (validated per kind on the server). */
  configJson: z.string().max(20_000, "Configuration is too large."),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

export const publishSchema = z.object({ effectiveFrom: zDate });

export type RuleFormInput = z.input<typeof ruleInputSchema>;
