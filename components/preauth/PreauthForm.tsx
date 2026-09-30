"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { preauthDetailsSchema, type PreauthDetailsInput } from "@/modules/preauth/preauth.validation";
import { CaseDetailsFields } from "@/components/eligibility/CaseDetailsFields";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { FormActions, FormGrid, FormSection, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";
import styles from "./PreauthForm.module.css";

type Coded = { id: string; code: string; name: string };

const STEPS = ["Medical", "Financial", "Clinical notes"] as const;

/** Which step each non-medical field lives on (medical fields default to step 0). */
const FIELD_STEP: Record<string, number> = {
  expectedStayDays: 1, roomCategory: 1, expectedInsuranceAmount: 1, patientContribution: 1,
  symptoms: 2, clinicalFindings: 2, medicalHistory: 2, investigationSummary: 2, proposedTreatment: 2, doctorName: 2, doctorRegistrationNo: 2, employeeId: 2,
};

/** Pre-authorization details, as a short step form. Used to create and to edit drafts. */
export function PreauthForm({
  action,
  defaults,
  diagnoses,
  procedures,
  submitLabel,
  onSaved,
}: {
  action: (i: PreauthDetailsInput) => Promise<ActionResult>;
  defaults?: Partial<PreauthDetailsInput>;
  diagnoses: Coded[];
  procedures: Coded[];
  submitLabel: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [stepIdx, setStep] = useState(0);
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, setError, formState } = useForm<PreauthDetailsInput>({
    resolver: zodResolver(preauthDetailsSchema),
    defaultValues: { claimType: "cashless", isAccident: "unknown", pedDeclared: "unknown", pedRelated: "unknown", ...defaults },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  // Jump to the earliest step holding an invalid field so errors are never hidden.
  const onInvalid = (errs: Record<string, unknown>) => {
    const steps = Object.keys(errs).map((k) => FIELD_STEP[k] ?? 0);
    setStep(Math.min(...steps));
  };

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setSaved(false);
        if (apply(await action(v))) {
          setSaved(true);
          onSaved?.();
          router.refresh();
        }
      }, onInvalid)}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      {saved && <Alert tone="success">Saved. Run the checks again to update the checklist.</Alert>}
      <ol className={styles.steps} aria-label="Form steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" className={styles.step} aria-current={i === stepIdx ? "step" : undefined} onClick={() => setStep(i)}>
              <span aria-hidden="true">{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      <div hidden={stepIdx !== 0}>
        <FormSection title="Diagnosis, treatment and admission">
          <FormGrid>
            <CaseDetailsFields register={register} errors={e} diagnoses={diagnoses} procedures={procedures} />
          </FormGrid>
        </FormSection>
      </div>
      <div hidden={stepIdx !== 1}>
        <FormSection title="Financial" hint="The approved amount can differ from these figures; the final bill is assessed separately.">
          <FormGrid>
            <TextField label="Expected length of stay (days)" inputMode="numeric" error={e.expectedStayDays?.message} {...register("expectedStayDays")} />
            <TextField label="Room category" placeholder="e.g. Single private AC" error={e.roomCategory?.message} {...register("roomCategory")} />
            <TextField label="Expected insurance amount (₹)" inputMode="decimal" error={e.expectedInsuranceAmount?.message} {...register("expectedInsuranceAmount")} />
            <TextField label="Expected patient contribution (₹)" inputMode="decimal" error={e.patientContribution?.message} {...register("patientContribution")} />
          </FormGrid>
        </FormSection>
      </div>
      <div hidden={stepIdx !== 2}>
        <FormSection title="Clinical notes" hint="Record what the treating doctor documented. Do not change medical information to fit a policy.">
          <FormGrid>
            <FullWidth><TextAreaField label="Symptoms / presenting complaints" error={e.symptoms?.message} {...register("symptoms")} /></FullWidth>
            <FullWidth><TextAreaField label="Clinical findings" error={e.clinicalFindings?.message} {...register("clinicalFindings")} /></FullWidth>
            <FullWidth><TextAreaField label="Relevant medical history" error={e.medicalHistory?.message} {...register("medicalHistory")} /></FullWidth>
            <FullWidth><TextAreaField label="Investigation summary" error={e.investigationSummary?.message} {...register("investigationSummary")} /></FullWidth>
            <FullWidth><TextAreaField label="Proposed treatment" error={e.proposedTreatment?.message} {...register("proposedTreatment")} /></FullWidth>
            <TextField label="Treating doctor" error={e.doctorName?.message} {...register("doctorName")} />
            <TextField label="Doctor registration no." error={e.doctorRegistrationNo?.message} {...register("doctorRegistrationNo")} />
            <TextField label="Employee / corporate ID (if group policy)" error={e.employeeId?.message} {...register("employeeId")} />
          </FormGrid>
        </FormSection>
      </div>

      <FormActions>
        {stepIdx > 0 && <Button type="button" variant="secondary" onClick={() => setStep(stepIdx - 1)}>Back</Button>}
        {stepIdx < STEPS.length - 1 && <Button type="button" variant="secondary" onClick={() => setStep(stepIdx + 1)}>Next</Button>}
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}
