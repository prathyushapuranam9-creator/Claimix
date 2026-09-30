import { z } from "zod";
import { zName, zOptionalEmail, zOptionalPhone, zOptionalText, zOptionalUuid, zPastDate } from "@/lib/validation";

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;

export const GENDER_LABEL: Record<(typeof GENDERS)[number], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  undisclosed: "Not disclosed",
};

export const patientInputSchema = z.object({
  fullName: zName,
  dob: zPastDate("Date of birth"),
  gender: z.enum(GENDERS, { message: "Select a gender option." }),
  phone: zOptionalPhone,
  email: zOptionalEmail,
  patientNo: zOptionalText(40).refine((v) => v === undefined || /^[A-Za-z0-9-]+$/.test(v), "Use letters, numbers and hyphens only."),
  // Only platform admins choose a hospital; staff always register into their own.
  hospitalId: zOptionalUuid,
});

export type PatientInput = z.input<typeof patientInputSchema>;
