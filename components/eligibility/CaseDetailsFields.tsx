"use client";

import type { FieldErrors, UseFormRegisterReturn } from "react-hook-form";
import type { caseDetailsShape } from "@/modules/eligibility/eligibility.validation";
import { SelectField, TextField } from "@/components/ui/Field";

type Opt = { id: string; code: string; name: string };
type CaseField = keyof typeof caseDetailsShape;

/** Case fields shared by the eligibility checker and pre-authorization (same names, same validation). */
export function CaseDetailsFields({
  register,
  errors,
  diagnoses,
  procedures,
}: {
  /** Any react-hook-form register whose form includes the shared case fields. */
  register: (name: CaseField) => UseFormRegisterReturn;
  errors: FieldErrors;
  diagnoses: Opt[];
  procedures: Opt[];
}) {
  const err = (k: string) => (errors[k]?.message as string | undefined) ?? undefined;
  const tri = (name: CaseField, label: string, hint?: string) => (
    <SelectField label={label} hint={hint} error={err(name)} {...register(name)}>
      <option value="unknown">Not known yet</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </SelectField>
  );
  return (
    <>
      <SelectField label="Cashless or reimbursement" required error={err("claimType")} {...register("claimType")}>
        <option value="cashless">Cashless</option>
        <option value="reimbursement">Reimbursement</option>
      </SelectField>
      <TextField label="Expected admission date" type="date" error={err("admissionDate")} {...register("admissionDate")} />
      <SelectField label="Diagnosis" error={err("diagnosisId")} {...register("diagnosisId")}>
        <option value="">Select diagnosis…</option>
        {diagnoses.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
      </SelectField>
      <SelectField label="Treatment / procedure" error={err("procedureId")} {...register("procedureId")}>
        <option value="">Select procedure…</option>
        {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </SelectField>
      {tri("isAccident", "Due to an accident?")}
      {tri("pedDeclared", "Pre-existing disease declared?", "As declared on the policy proposal.")}
      {tri("pedRelated", "Is this treatment related to that disease?")}
      <TextField label="Estimated cost (₹)" inputMode="decimal" error={err("estimatedCost")} {...register("estimatedCost")} />
      <TextField label="Room rent per day (₹)" inputMode="decimal" error={err("roomRentPerDay")} {...register("roomRentPerDay")} />
    </>
  );
}
