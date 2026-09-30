"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { INDIAN_STATES } from "@/lib/india";
import { useServerResult } from "@/lib/use-action-form";
import { hospitalInputSchema, type HospitalInput } from "@/modules/hospitals/hospitals.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormActions, FormGrid, FormSection, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

export function HospitalForm({
  action,
  defaults,
  cancelHref,
  submitLabel,
}: {
  action: (input: HospitalInput) => Promise<ActionResult>;
  defaults?: Partial<HospitalInput>;
  cancelHref: string;
  submitLabel: string;
}) {
  const { register, handleSubmit, setError, formState } = useForm<HospitalInput>({
    resolver: zodResolver(hospitalInputSchema),
    defaultValues: { departments: "", ...defaults },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  return (
    <form className={formStyles.form} onSubmit={handleSubmit(async (v) => apply(await action(v)))} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormSection title="Hospital">
        <FormGrid>
          <TextField label="Hospital name" required error={e.name?.message} {...register("name")} />
          <TextField label="Registration number" error={e.registrationNo?.message} {...register("registrationNo")} />
          <TextField label="City" required error={e.city?.message} {...register("city")} />
          <SelectField label="State / UT" required error={e.state?.message} {...register("state")}>
            <option value="">Select…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </SelectField>
          <FullWidth>
            <TextAreaField label="Address" error={e.address?.message} {...register("address")} />
          </FullWidth>
          <FullWidth>
            <TextField label="Departments" hint="Separate with commas, e.g. Cardiology, Orthopaedics" error={e.departments?.message} {...register("departments")} />
          </FullWidth>
        </FormGrid>
      </FormSection>
      <FormSection title="Contact">
        <FormGrid>
          <TextField label="Phone" type="tel" error={e.phone?.message} {...register("phone")} />
          <TextField label="Email" type="email" error={e.email?.message} {...register("email")} />
        </FormGrid>
      </FormSection>
      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}
