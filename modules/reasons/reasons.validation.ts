import { z } from "zod";

export const REASON_KINDS = { query: "Query", rejection: "Rejection", both: "Query or rejection" } as const;

export const reasonInputSchema = z.object({
  title: z.string().trim().min(3, "Enter a title.").max(200),
  meaning: z.string().trim().min(10, "Explain what it means.").max(2000),
  whatToCheck: z.string().trim().min(10, "Explain what to check.").max(2000),
  requiredAction: z.string().trim().min(10, "Explain the required action.").max(2000),
  kind: z.enum(["query", "rejection", "both"]),
});

export type ReasonInput = z.input<typeof reasonInputSchema>;
