"use client";

import Link from "next/link";
import { useState } from "react";
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
  // Existing records the server found with the same name and date of birth (a warning the user can confirm).
  const [duplicates, setDuplicates] = useState<{ id: string; patientNo: string }[]>([]);

  const submit = (confirmDuplicate: boolean) =>
    handleSubmit(async (v) => {
      const r = await action(confirmDuplicate ? { ...v, confirmDuplicate: true } : v);
      const found = !r.ok ? r.fieldErrors?._duplicate : undefined;
      if (found?.length) {
        setDuplicates(found.map((x) => ({ id: x.split("|")[0]!, patientNo: x.split("|")[1] ?? "" })));
        return;
      }
      setDuplicates([]);
      apply(r);
    });

  return (
    <form className={formStyles.form} onSubmit={submit(false)} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      {duplicates.length > 0 && (
        <Alert tone="warning" title="This patient may already be registered">
          <p>
            A patient with the same name and date of birth is already registered at this hospital:{" "}
            {duplicates.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <Link href={`/patients/${d.id}`} target="_blank" rel="noopener noreferrer">{d.patientNo}</Link>
              </span>
            ))}
            . Open the existing record to avoid a duplicate, or register this person as a separate patient if they are not the same individual.
          </p>
          <FormActions>
            <Button type="button" variant="secondary" loading={formState.isSubmitting} onClick={() => void submit(true)()}>
              Register as a new patient anyway
            </Button>
          </FormActions>
        </Alert>
      )}
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
