"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { claimDetailsSchema, type ClaimDetailsInput } from "@/modules/claims/claims.validation";
import { Button } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormActions, FormGrid, FormSection, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

type Coded = { id: string; code: string; name: string };

/** Final claim details (final bill, dates, final diagnosis). Used for create and edit. */
export function ClaimForm({
  action,
  defaults,
  diagnoses,
  procedures,
  submitLabel,
}: {
  action: (i: ClaimDetailsInput) => Promise<ActionResult>;
  defaults?: Partial<ClaimDetailsInput>;
  diagnoses: Coded[];
  procedures: Coded[];
  submitLabel: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, setError, formState } = useForm<ClaimDetailsInput>({ resolver: zodResolver(claimDetailsSchema), defaultValues: defaults });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  const tri = (name: "isAccident" | "pedDeclared" | "pedRelated", label: string) => (
    <SelectField label={label} error={e[name]?.message} {...register(name)}>
      <option value="unknown">Not known yet</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </SelectField>
  );

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setSaved(false);
        if (apply(await action(v))) {
          setSaved(true);
          router.refresh();
        }
      })}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      {saved && <Alert tone="success">Saved. Run the checks again to update the checklist.</Alert>}
      <FormSection title="Hospital stay and final bill" hint="Enter the figures from the final itemised bill. The approved amount can differ from the pre-authorized estimate.">
        <FormGrid>
          <TextField label="Admission date" type="date" error={e.admissionDate?.message} {...register("admissionDate")} />
          <TextField label="Discharge date" type="date" error={e.dischargeDate?.message} {...register("dischargeDate")} />
          <TextField label="Final bill number" error={e.billNumber?.message} {...register("billNumber")} />
          <TextField label="Final bill amount (₹)" inputMode="decimal" error={e.claimedAmount?.message} {...register("claimedAmount")} />
          <TextField label="Room rent per day (₹)" inputMode="decimal" error={e.roomRentPerDay?.message} {...register("roomRentPerDay")} />
        </FormGrid>
      </FormSection>
      <FormSection title="Final diagnosis and treatment">
        <FormGrid>
          <SelectField label="Final diagnosis" error={e.diagnosisId?.message} {...register("diagnosisId")}>
            <option value="">Select diagnosis…</option>
            {diagnoses.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
          </SelectField>
          <SelectField label="Procedure performed" error={e.procedureId?.message} {...register("procedureId")}>
            <option value="">Select procedure…</option>
            {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          {tri("isAccident", "Due to an accident?")}
          {tri("pedDeclared", "Pre-existing disease declared?")}
          {tri("pedRelated", "Related to that disease?")}
          <FullWidth><TextAreaField label="Final diagnosis notes" error={e.finalDiagnosisNotes?.message} {...register("finalDiagnosisNotes")} /></FullWidth>
          <FullWidth><TextAreaField label="Treatment given" error={e.treatmentGiven?.message} {...register("treatmentGiven")} /></FullWidth>
          <FullWidth><TextAreaField label="Non-payable items explained to the patient" hint="e.g. consumables, registration, attendant charges." error={e.nonPayableNotes?.message} {...register("nonPayableNotes")} /></FullWidth>
        </FormGrid>
      </FormSection>
      <FormActions>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}
