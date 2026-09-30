import { z } from "zod";
import { zName, zOptionalPhone, zOptionalText } from "@/lib/validation";

export const ORGANIZATION_TYPES = [
  { value: "hospital", label: "Hospital / insurance desk" },
  { value: "insurer", label: "Insurance company" },
  { value: "tpa", label: "TPA" },
  { value: "scheme_desk", label: "Government-scheme desk" },
  { value: "other", label: "Other" },
] as const;

export const accessRequestSchema = z.object({
  fullName: zName,
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(320),
  organizationName: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(200, "Keep this under 200 characters.")
    .regex(/^[\p{L}\p{M}\p{N} .'()&,/-]+$/u, "Use letters, numbers, spaces and basic punctuation only."),
  organizationType: z.enum(ORGANIZATION_TYPES.map((o) => o.value) as [string, ...string[]], { message: "Choose an organization type." }),
  jobTitle: zOptionalText(100),
  phone: zOptionalPhone,
  message: zOptionalText(1000),
  /** Honeypot: hidden from people, filled by naive bots. */
  website: z.string().max(200).optional(),
});

export type AccessRequestInput = z.input<typeof accessRequestSchema>;

export const accessRequestDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"], { message: "Choose approve or decline." }),
  note: zOptionalText(500),
});

export type AccessRequestDecisionInput = z.input<typeof accessRequestDecisionSchema>;
