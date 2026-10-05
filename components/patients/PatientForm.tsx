"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { GENDER_LABEL, GENDERS, PATIENT_DEPARTMENTS, patientInputSchema, type PatientInput } from "@/modules/patients/patients.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormActions, FormGrid, FormSection, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

interface Props {
  action: (input: PatientInput) => Promise<ActionResult>;
  defaults?: Partial<PatientInput>;
  /** Only provided for platform admins, who must choose the registering hospital. */
  hospitals?: { id: string; name: string }[];
  cancelHref: string;
  submitLabel: string;
}

export function PatientForm({ action, defaults, hospitals, cancelHref, submitLabel }: Props) {
  const { register, handleSubmit, setError, formState } = useForm<PatientInput>({
    resolver: zodResolver(patientInputSchema),
    defaultValues: { gender: "undisclosed", ...defaults },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  return (
    <form className={formStyles.form} onSubmit={handleSubmit(async (v) => apply(await action(v)))} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormSection title="Patient details" hint="Use the name exactly as it appears on the ID proof and insurance card to avoid mismatch queries.">
        <FormGrid>
          <TextField label="Full name" required autoComplete="off" error={e.fullName?.message} {...register("fullName")} />
          <TextField label="Date of birth" type="date" required error={e.dob?.message} {...register("dob")} />
          <SelectField label="Gender" required error={e.gender?.message} {...register("gender")}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{GENDER_LABEL[g]}</option>
            ))}
          </SelectField>
          <TextField label="Hospital patient number" hint="Leave blank to generate one." error={e.patientNo?.message} {...register("patientNo")} />
          {hospitals && (
            <SelectField label="Registering hospital" required error={e.hospitalId?.message} {...register("hospitalId")}>
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
          <SelectField label="Department" error={e.department?.message} {...register("department")}>
            <option value="">Not assigned</option>
            {Object.entries(PATIENT_DEPARTMENTS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </SelectField>
          <FullWidth>
            <TextAreaField label="Reason for visit" rows={2} maxLength={300} error={e.visitReason?.message} {...register("visitReason")} />
          </FullWidth>
        </FormGrid>
      </FormSection>
      <FormSection title="Contact">
        <FormGrid>
          <TextField label="Mobile number" type="tel" autoComplete="off" error={e.phone?.message} {...register("phone")} />
          <TextField label="Email" type="email" autoComplete="off" error={e.email?.message} {...register("email")} />
        </FormGrid>
      </FormSection>
      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}
