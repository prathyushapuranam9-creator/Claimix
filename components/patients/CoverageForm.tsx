"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { coverageInputSchema, RELATIONSHIPS, RELATIONSHIP_LABEL, type CoverageInput } from "@/modules/patients/coverage.validation";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { FormGrid, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

type PolicyOpt = { id: string; name: string; category: "private" | "government" };

export function CoverageForm({ action, policies }: { action: (i: CoverageInput) => Promise<ActionResult>; policies: PolicyOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, setError, reset, formState } = useForm<CoverageInput>({ resolver: zodResolver(coverageInputSchema), defaultValues: { relationship: "self" } });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Add coverage</Button>;

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        if (apply(await action(v))) {
          reset();
          setOpen(false);
          router.refresh();
        }
      })}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
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
      </FormGrid>
      <div className={formStyles.actionsInline}>
        <Button type="submit" loading={formState.isSubmitting}>Save coverage</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
