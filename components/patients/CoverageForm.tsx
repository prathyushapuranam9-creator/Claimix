"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import {
  COVERAGE_VERIFICATION,
  coverageInputSchema,
  RELATIONSHIPS,
  RELATIONSHIP_LABEL,
  VERIFICATION_LABEL,
  type CoverageInput,
} from "@/modules/patients/coverage.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { FormGrid, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

type PolicyOpt = { id: string; name: string; category: "private" | "government" };

interface Props {
  action: (i: CoverageInput) => Promise<ActionResult>;
  policies: PolicyOpt[];
  /**
   * Values read from the patient's insurance document, or the current values when editing. Only
   * fields the document actually stated are filled; the rest stay empty for staff to type.
   */
  defaults?: Partial<CoverageInput>;
  /** Shown expanded (reviewing extracted details, or editing) instead of behind the toggle. */
  startOpen?: boolean;
  toggleLabel?: string;
  submitLabel?: string;
  /** Where Cancel goes when the form is not collapsible. */
  cancelHref?: string;
}

/**
 * Records or corrects one coverage. Every field is editable whatever filled it: details read from an
 * uploaded document are only a starting point, and only what is submitted here is saved.
 */
export function CoverageForm({ action, policies, defaults, startOpen, toggleLabel = "Add coverage", submitLabel = "Save coverage", cancelHref }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(!!startOpen);
  const { register, handleSubmit, setError, reset, formState } = useForm<CoverageInput>({
    resolver: zodResolver(coverageInputSchema),
    defaultValues: { relationship: "self", verificationStatus: "requires_verification", ...defaults },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>{toggleLabel}</Button>;

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        if (apply(await action(v))) {
          if (startOpen) return; // the action navigates back to the patient
          reset();
          setOpen(false);
          router.refresh();
        }
      })}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      {defaults?.sourceDocumentId ? <input type="hidden" {...register("sourceDocumentId")} /> : null}
      <FormGrid>
        <SelectField label="Policy / scheme" required error={e.policyId?.message} {...register("policyId")}>
          <option value="">Select…</option>
          <optgroup label="Private insurance">
            {policies.filter((p) => p.category === "private").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
          <optgroup label="Government schemes">
            {policies.filter((p) => p.category === "government").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        </SelectField>
        <TextField label="Member / beneficiary ID" required hint="Exactly as on the card or scheme record." error={e.memberId?.message} {...register("memberId")} />
        <SelectField label="Relationship to policyholder" required error={e.relationship?.message} {...register("relationship")}>
          {RELATIONSHIPS.map((r) => <option key={r} value={r}>{RELATIONSHIP_LABEL[r]}</option>)}
        </SelectField>
        <TextField label="First inception date" type="date" hint="With continuous renewals." error={e.inceptionDate?.message} {...register("inceptionDate")} />
        <TextField label="Cover start" type="date" required error={e.coverStart?.message} {...register("coverStart")} />
        <TextField label="Cover end" type="date" required error={e.coverEnd?.message} {...register("coverEnd")} />
        <TextField label="Sum insured (₹)" inputMode="decimal" error={e.sumInsured?.message} {...register("sumInsured")} />
        <TextField label="Available balance (₹)" inputMode="decimal" hint="After earlier claims this policy year." error={e.sumInsuredAvailable?.message} {...register("sumInsuredAvailable")} />
        <SelectField
          label="Verification"
          required
          hint="Choose 'Requires verification' when the insurance document isn't available yet. It does not block eligibility checks."
          error={e.verificationStatus?.message}
          {...register("verificationStatus")}
        >
          {COVERAGE_VERIFICATION.map((v) => <option key={v} value={v}>{VERIFICATION_LABEL[v]}</option>)}
        </SelectField>
      </FormGrid>
      <div className={formStyles.actionsInline}>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
        {cancelHref ? (
          <ButtonLink href={cancelHref} variant="ghost">Cancel</ButtonLink>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        )}
      </div>
    </form>
  );
}
