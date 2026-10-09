"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { GENDER_LABEL, GENDERS, PATIENT_DEPARTMENTS } from "@/modules/patients/patients.validation";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormGrid, FormSection, FullWidth } from "@/components/ui/Form";

export type PatientField = "fullName" | "dob" | "gender" | "patientNo" | "hospitalId" | "department" | "visitReason" | "phone" | "email" | "abhaNumber" | "abhaAddress";

/**
 * The patient's own details, with the same labels and validation wherever they are collected: the
 * patient form and step 1 of front-desk registration (where they are nested under `newPatient`).
 * The caller maps each field name onto its own form, as the shared case fields do.
 */
export function PatientFields({
  register,
  errorFor,
  hospitals,
  departments,
  abha,
}: {
  register: (name: PatientField) => UseFormRegisterReturn;
  errorFor: (name: PatientField) => string | undefined;
  /** Only provided for platform admins, who must choose the registering hospital. */
  hospitals?: { id: string; name: string }[];
  /** Limits the department list (registration offers only departments with a doctor). */
  departments?: readonly string[];
  /** Shows the ABHA fields. Recorded as presented; never required and never created here. */
  abha?: boolean;
}) {
  const departmentEntries = Object.entries(PATIENT_DEPARTMENTS).filter(([k]) => !departments || departments.includes(k));
  return (
    <>
      <FormSection title="Patient details" hint="Use the name exactly as it appears on the patient's photo ID.">
        <FormGrid>
          <TextField label="Full name" required autoComplete="off" error={errorFor("fullName")} {...register("fullName")} />
          <TextField label="Date of birth" type="date" required error={errorFor("dob")} {...register("dob")} />
          <SelectField label="Gender" required error={errorFor("gender")} {...register("gender")}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{GENDER_LABEL[g]}</option>
            ))}
          </SelectField>
          <TextField label="Hospital patient number" hint="Leave blank to generate one." error={errorFor("patientNo")} {...register("patientNo")} />
          {hospitals && (
            <SelectField label="Registering hospital" required error={errorFor("hospitalId")} {...register("hospitalId")}>
              <option value="">Select hospital…</option>
              {hospitals.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </SelectField>
          )}
        </FormGrid>
      </FormSection>
      <FormSection title="Visit" hint="Describe the reason in simple words, e.g. 'Headache and dizziness'.">
        <FormGrid>
          <SelectField label="Department" error={errorFor("department")} {...register("department")}>
            <option value="">Not assigned</option>
            {departmentEntries.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </SelectField>
          <FullWidth>
            <TextAreaField label="Reason for visit" rows={2} maxLength={300} error={errorFor("visitReason")} {...register("visitReason")} />
          </FullWidth>
        </FormGrid>
      </FormSection>
      {abha && (
        <FormSection title="ABHA" hint="As the patient presents it. Claimix records these; it does not verify them with ABDM or create an ABHA.">
          <FormGrid>
            <TextField label="ABHA number" inputMode="numeric" placeholder="14 digits" error={errorFor("abhaNumber")} {...register("abhaNumber")} />
            <TextField label="ABHA address" placeholder="name@abdm" error={errorFor("abhaAddress")} {...register("abhaAddress")} />
          </FormGrid>
        </FormSection>
      )}
      <FormSection title="Contact">
        <FormGrid>
          <TextField label="Mobile number" type="tel" autoComplete="off" error={errorFor("phone")} {...register("phone")} />
          <TextField label="Email" type="email" autoComplete="off" error={errorFor("email")} {...register("email")} />
        </FormGrid>
      </FormSection>
    </>
  );
}
