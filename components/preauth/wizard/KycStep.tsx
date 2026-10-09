"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { wizardKycSchema, type WizardKycInput } from "@/modules/preauth/preauth.validation";
import { SelectField, TextField } from "@/components/ui/Field";
import { FormGrid, FormSection, formStyles } from "@/components/ui/Form";
import { Alert, Card, Stack } from "@/components/ui/Surface";
import styles from "./NewClaimWizard.module.css";

export const KYC_FORM_ID = "wizard-kyc";

export interface KycOptions {
  insurers: { id: string; name: string }[];
  tpasByInsurer: Record<string, { id: string; name: string }[]>;
}

export interface KycActions {
  raise: (input: { beneficiaryId?: string; kyc: WizardKycInput }) => Promise<ActionResult<string>>;
  saveKyc: (id: string, kyc: WizardKycInput) => Promise<ActionResult>;
}

/**
 * Step 1: KYC & Policy, opened for the patient chosen with Find (its details arrive filled from the record). Identity
 * and policy papers are added in Supporting Documents. Aadhaar is optional: never shown in full, only its last 4 digits.
 * `onDirty` reports unsaved edits, so the wizard can warn before leaving them unsaved.
 */
export function KycStep({
  caseId,
  defaults,
  beneficiaryId,
  matched,
  options,
  aadhaarOnFile,
  actions,
  disabled,
  onDone,
  onDirty,
}: {
  caseId?: string;
  defaults: Partial<WizardKycInput>;
  beneficiaryId: string;
  matched: string;
  options: KycOptions;
  /** The Aadhaar already known (on the case or the patient record), masked to its last 4 digits. */
  aadhaarOnFile?: string | null;
  actions: KycActions;
  disabled?: boolean;
  onDone: (id: string) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { register, handleSubmit, setError, setValue, control, formState } = useForm<WizardKycInput>({
    resolver: zodResolver(wizardKycSchema),
    defaultValues: { mode: "typed", ...defaults },
  });
  const { formError, setFormError, apply } = useServerResult(setError);
  const e = formState.errors;
  const insurerId = useWatch({ control, name: "insurerId" });
  const tpas = insurerId ? (options.tpasByInsurer[insurerId] ?? []) : [];


  const submit = handleSubmit(async (kyc) => {
    setFormError(null);
    if (caseId) {
      if (apply(await actions.saveKyc(caseId, kyc))) {
        onDirty?.(false);
        onDone(caseId);
      }
      return;
    }
    const r = await actions.raise({ beneficiaryId, kyc });
    if (!apply(r)) return;
    onDirty?.(false);
    onDone(r.data);
  });

  return (
    <form id={KYC_FORM_ID} className={formStyles.form} noValidate onSubmit={submit} onChange={() => onDirty?.(true)} aria-busy={formState.isSubmitting || undefined}>
      <Stack>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Card>
          <fieldset disabled={disabled} className={styles.plainFieldset}>
            <FormSection title="Patient details">
              <p className={styles.matched} data-testid="matched-member">Patient on record: {matched}</p>
              <FormGrid>
                <TextField label="UHID / IP Number" readOnly hint="From the patient record." {...register("uhid")} />
                <TextField
                  label="Aadhaar Number"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  placeholder={aadhaarOnFile ?? "12 digits"}
                  hint={aadhaarOnFile ? `On file: ${aadhaarOnFile}. Enter the full number to check it; leave blank to keep it.` : "Optional. Only the last 4 digits are ever shown."}
                  error={e.aadhaar?.message}
                  {...register("aadhaar")}
                />
                <TextField label="Patient Name" required error={e.patientName?.message} {...register("patientName")} />
                <SelectField label="Gender" required error={e.gender?.message} {...register("gender")}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </SelectField>
                <TextField label="Date of Birth" type="date" required error={e.dob?.message} {...register("dob")} />
                <TextField label="Mobile" type="tel" inputMode="numeric" maxLength={10} required error={e.mobile?.message} {...register("mobile")} />
              </FormGrid>
            </FormSection>
            <FormSection title="Policy details">
              <FormGrid>
                <SelectField
                  label="Insurer"
                  required
                  error={e.insurerId?.message}
                  {...register("insurerId", { onChange: () => setValue("tpaId", "") })}
                >
                  <option value="">Select the insurer</option>
                  {options.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </SelectField>
                <SelectField label="TPA" error={e.tpaId?.message} disabled={!insurerId} {...register("tpaId")}>
                  {!insurerId ? <option value="">Choose the insurer first</option> : <option value="">{tpas.length ? "No TPA / select" : "No TPA on this insurer's policies"}</option>}
                  {tpas.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </SelectField>
                <TextField label="Policy Number" required error={e.policyNumber?.message} {...register("policyNumber")} />
                <TextField label="Policy From" type="date" required error={e.policyFrom?.message} {...register("policyFrom")} />
                <TextField label="Policy To" type="date" required error={e.policyTo?.message} {...register("policyTo")} />
                <TextField label="Sum Insured (₹)" inputMode="decimal" error={e.sumInsured?.message} {...register("sumInsured")} />
                <TextField label="TPA Card / Member ID" error={e.memberId?.message} {...register("memberId")} />
              </FormGrid>
            </FormSection>
          </fieldset>
        </Card>
        {formState.isSubmitting && <p className={styles.muted} role="status">Saving…</p>}
      </Stack>
    </form>
  );
}
