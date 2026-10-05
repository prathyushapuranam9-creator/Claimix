import { z } from "zod";
import { zName, zOptionalEmail, zOptionalPhone, zOptionalText, zOptionalUuid, zPastDate } from "@/lib/validation";

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;

export const GENDER_LABEL: Record<(typeof GENDERS)[number], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  undisclosed: "Not disclosed",
};

/** Hospital departments a patient can be registered / treated in (stored by key, shown by label). */
export const PATIENT_DEPARTMENTS = {
  general_medicine: "General Medicine",
  cardiology: "Cardiology",
  neurology: "Neurology",
  orthopedics: "Orthopedics",
  gynecology: "Gynecology",
  obstetrics: "Obstetrics",
  pediatrics: "Pediatrics",
  oncology: "Oncology",
  nephrology: "Nephrology",
  gastroenterology: "Gastroenterology",
  pulmonology: "Pulmonology",
  ent: "ENT",
  ophthalmology: "Ophthalmology",
  dermatology: "Dermatology",
  urology: "Urology",
  psychiatry: "Psychiatry",
  general_surgery: "General Surgery",
  emergency: "Emergency",
} as const;

export type PatientDepartment = keyof typeof PATIENT_DEPARTMENTS;

/** Shown wherever a patient has no department recorded. */
export const NO_DEPARTMENT = "Not Assigned";
/** Shown wherever a patient has no reason for visit recorded. */
export const NO_VISIT_REASON = "Not Available";

export function departmentLabel(key: string | null | undefined): string {
  return key && key in PATIENT_DEPARTMENTS ? PATIENT_DEPARTMENTS[key as PatientDepartment] : NO_DEPARTMENT;
}

export const patientInputSchema = z.object({
  fullName: zName,
  dob: zPastDate("Date of birth"),
  gender: z.enum(GENDERS, { message: "Select a gender option." }),
  phone: zOptionalPhone,
  email: zOptionalEmail,
  patientNo: zOptionalText(40).refine((v) => v === undefined || /^[A-Za-z0-9-]+$/.test(v), "Use letters, numbers and hyphens only."),
  department: z.preprocess((v) => (v === "" ? undefined : v), z.enum(Object.keys(PATIENT_DEPARTMENTS) as [PatientDepartment, ...PatientDepartment[]], { message: "Select a department from the list." }).optional()),
  visitReason: zOptionalText(300),
  // Only platform admins choose a hospital; staff always register into their own.
  hospitalId: zOptionalUuid,
  /** Set after the user has seen the "possible duplicate" warning and chose to register anyway. */
  confirmDuplicate: z.boolean().optional(),
});

export type PatientInput = z.input<typeof patientInputSchema>;
