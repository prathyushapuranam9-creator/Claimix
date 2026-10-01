import { z } from "zod";
import { zName, zOptionalText } from "@/lib/validation";

export const schemeInputSchema = z.object({
  name: zName,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Enter a short code.")
    .max(30)
    .regex(/^[A-Z0-9-]+$/, "Use capital letters, numbers and hyphens only."),
  authority: z.string().trim().min(2, "Enter the administering authority.").max(200, "Keep this under 200 characters."),
  description: zOptionalText(1000),
});

export type SchemeInput = z.input<typeof schemeInputSchema>;
