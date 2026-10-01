import { z } from "zod";

const zCodeName = z.string().trim().min(2, "Enter a name.").max(250, "Keep this under 250 characters.");

/** ICD-10 style diagnosis code, e.g. K35 or K35.80. */
export const diagnosisInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, "Use an ICD-10 code such as K35 or K35.80."),
  name: zCodeName,
});

/** Internal procedure code, e.g. LAP-CHOLE. */
export const procedureInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, "Use 2–30 capital letters, numbers and hyphens."),
  name: zCodeName,
});

export type DiagnosisInput = z.input<typeof diagnosisInputSchema>;
export type ProcedureInput = z.input<typeof procedureInputSchema>;
