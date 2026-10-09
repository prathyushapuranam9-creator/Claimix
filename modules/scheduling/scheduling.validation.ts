import { z } from "zod";
import { zDate, zMoney, zName, zOptionalText, zUuid } from "@/lib/validation";
import { PATIENT_DEPARTMENTS, patientInputSchema, type PatientDepartment } from "@/modules/patients/patients.validation";

/** What the patient is being registered for. */
export const VISIT_TYPES = ["opd_consultation", "ip_admission", "pre_auth"] as const;

export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  opd_consultation: "OPD consultation",
  ip_admission: "IP admission",
  pre_auth: "Pre-auth",
};

/** What each visit type means at the desk, shown beside the choice. */
export const VISIT_TYPE_HINT: Record<VisitType, string> = {
  opd_consultation: "The patient comes in for a consultation and goes home the same day.",
  ip_admission: "The patient is admitted and stays in the hospital until discharge.",
  pre_auth: "A planned treatment the payer is asked to approve before the patient is admitted.",
};

/** How the consultation amount was taken at the desk. */
export const PAYMENT_METHODS = ["cash", "upi", "card"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
};

export const departmentKeys = Object.keys(PATIENT_DEPARTMENTS) as [PatientDepartment, ...PatientDepartment[]];

/** A doctor the hospital offers appointments with. Maintained by an administrator. */
export const doctorInputSchema = z.object({
  hospitalId: zUuid,
  fullName: zName,
  department: z.enum(departmentKeys, { message: "Select a department from the list." }),
  registrationNo: zOptionalText(60),
  consultationFee: zMoney,
});

export type DoctorInput = z.input<typeof doctorInputSchema>;

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const zTime = z.string().regex(HHMM, "Enter a time as HH:MM, e.g. 09:30.");

/** Opens equal-length slots for one doctor on one day, e.g. 09:00–13:00 in 20-minute slots. */
export const slotOpeningSchema = z
  .object({
    doctorId: zUuid,
    slotDate: zDate,
    from: zTime,
    to: zTime,
    minutes: z.coerce.number().int().min(5, "Slots must be at least 5 minutes.").max(240, "Slots can be at most 4 hours."),
  })
  .superRefine((v, ctx) => {
    if (v.to <= v.from) ctx.addIssue({ code: "custom", path: ["to"], message: "The end time must be after the start time." });
  });

export type SlotOpeningInput = z.input<typeof slotOpeningSchema>;

/**
 * The one request that completes a registration. It carries either the existing patient that was found
 * in step 1 or the details of a new one, plus the chosen visit type, doctor, slot, payment state and the
 * rights & responsibilities acknowledgement. Nothing is written until this validates.
 */
/** Inpatient details taken at admission. Only used when the visit type is an IP admission. */
export const admissionDetailsSchema = z.object({
  ward: zOptionalText(80),
  bed: zOptionalText(40),
  expectedStayDays: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1, "At least 1 day.").max(365, "At most 365 days.").optional(),
  ),
});

export type AdmissionDetailsInput = z.input<typeof admissionDetailsSchema>;

/**
 * What the desk recorded about the payment. The reference is a non-sensitive handle only: the card's
 * last four digits, or a UPI reference. Full card details never leave the browser.
 */
export const paymentCaptureSchema = z.object({
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || undefined : v),
    z.string().regex(/^[A-Za-z0-9*@.\/_-]{2,40}$/, "Use letters, numbers and - / _ @ . * only.").optional(),
  ),
});

export const registrationInputSchema = z
  .object({
    /** An existing patient selected in step 1. */
    patientId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid("Select a valid patient.").optional()),
    /** Details for a patient who is not in Claimix yet. */
    newPatient: patientInputSchema.optional(),
    visitType: z.enum(VISIT_TYPES, { message: "Select the visit type." }),
    doctorId: zUuid,
    slotId: zUuid,
    /** The method money was taken by; omitted when it is to be collected later. */
    paymentMethod: z.preprocess((v) => (v === "" ? undefined : v), z.enum(PAYMENT_METHODS).optional()),
    /** The card's last four digits, or the UPI reference. Never full card details. */
    paymentReference: paymentCaptureSchema.shape.reference,
    collectPaymentLater: z.coerce.boolean().default(false),
    /** Required when the visit type is an IP admission. */
    admission: admissionDetailsSchema.optional(),
    /** The rights & responsibilities acknowledgement; registration cannot complete without it. */
    consentAcknowledged: z.coerce.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.patientId && !v.newPatient) ctx.addIssue({ code: "custom", path: ["patientId"], message: "Find the patient or enter the new patient's details." });
    if (v.patientId && v.newPatient) ctx.addIssue({ code: "custom", path: ["patientId"], message: "Register either the existing patient or a new one, not both." });
    if (v.paymentMethod !== "card" && v.paymentMethod !== "upi" && v.paymentReference) {
      ctx.addIssue({ code: "custom", path: ["paymentReference"], message: "A reference only applies to a UPI or card payment." });
    }
    if (v.collectPaymentLater && v.paymentMethod) ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Payment is marked to be collected later, so no method applies." });
    if (!v.consentAcknowledged) ctx.addIssue({ code: "custom", path: ["consentAcknowledged"], message: CONSENT_REQUIRED });
  });

/** Shown wherever the acknowledgement is missing, in the UI and from the server. */
export const CONSENT_REQUIRED = "Patient Rights & Responsibilities consent required.";

export type RegistrationInput = z.input<typeof registrationInputSchema>;

/** The three things the acknowledgement covers, shown to staff before they confirm it. */
export const CONSENT_POINTS = [
  "Patient rights and responsibilities explained to the patient or their representative.",
  "Hospital privacy policy explained.",
  "Consent to treatment and billing taken where applicable.",
] as const;

/** Ends an inpatient stay. The note is what the desk records about the discharge. */
export const dischargeSchema = z.object({
  note: zOptionalText(500),
});

export type DischargeInput = z.input<typeof dischargeSchema>;
