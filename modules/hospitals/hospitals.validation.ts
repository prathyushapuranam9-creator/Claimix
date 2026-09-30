import { z } from "zod";
import { INDIAN_STATES } from "@/lib/india";
import { zName, zOptionalEmail, zOptionalPhone, zOptionalText, zUuid } from "@/lib/validation";

export const NETWORK_STATUSES = ["network", "non_network", "empanelled", "suspended", "unverified"] as const;

export const NETWORK_STATUS_LABEL: Record<(typeof NETWORK_STATUSES)[number], string> = {
  network: "Network (cashless tie-up)",
  empanelled: "Empanelled (government scheme)",
  non_network: "Non-network",
  suspended: "Suspended",
  unverified: "Not verified",
};

export const hospitalInputSchema = z.object({
  name: zName,
  registrationNo: zOptionalText(100),
  city: z.string().trim().min(2, "Enter the city.").max(100),
  state: z.enum(INDIAN_STATES, { message: "Select a state or union territory." }),
  address: zOptionalText(500),
  // Comma-separated list from the form; kept as a string so client and server parse the same shape.
  departments: z
    .string()
    .max(1000, "Keep the list under 1000 characters.")
    .refine((v) => splitDepartments(v).length <= 40, "List at most 40 departments.")
    .refine((v) => splitDepartments(v).every((d) => d.length <= 80), "Department names must be under 80 characters."),
  phone: zOptionalPhone,
  email: zOptionalEmail,
});

export const networkInputSchema = z.object({
  payerType: z.enum(["insurer", "tpa", "scheme"], { message: "Select a payer type." }),
  payerId: zUuid,
  status: z.enum(NETWORK_STATUSES, { message: "Select a status." }),
  cashlessAvailable: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
});

export type HospitalInput = z.input<typeof hospitalInputSchema>;
export type NetworkInput = z.input<typeof networkInputSchema>;

export function splitDepartments(v: string): string[] {
  return [...new Set(v.split(",").map((d) => d.trim()).filter(Boolean))];
}
