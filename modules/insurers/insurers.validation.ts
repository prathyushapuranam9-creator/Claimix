import { z } from "zod";
import { zName, zOptionalEmail, zOptionalPhone, zOptionalText } from "@/lib/validation";

const zCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Enter a short code.")
  .max(30)
  .regex(/^[A-Z0-9-]+$/, "Use capital letters, numbers and hyphens only.");

export const insurerInputSchema = z.object({
  name: zName,
  code: zCode,
  claimsPhone: zOptionalPhone,
  claimsEmail: zOptionalEmail,
  website: zOptionalText(300).refine((v) => v === undefined || /^https:\/\/[^\s]+$/.test(v), "Enter a full https:// address."),
});

export const tpaInputSchema = z.object({
  name: zName,
  code: zCode,
  phone: zOptionalPhone,
  email: zOptionalEmail,
});

export type InsurerInput = z.input<typeof insurerInputSchema>;
export type TpaInput = z.input<typeof tpaInputSchema>;
