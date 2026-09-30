"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { REASON_KINDS, reasonInputSchema, type ReasonInput } from "@/modules/reasons/reasons.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormActions, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

export function ReasonForm({ action, defaults }: { action: (i: ReasonInput) => Promise<ActionResult>; defaults: ReasonInput }) {
  const { register, handleSubmit, setError, formState } = useForm<ReasonInput>({ resolver: zodResolver(reasonInputSchema), defaultValues: defaults });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  return (
    <form className={formStyles.form} noValidate onSubmit={handleSubmit(async (v) => apply(await action(v)))}>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <TextField label="Reason" required error={e.title?.message} {...register("title")} />
      <SelectField label="Used for" error={e.kind?.message} {...register("kind")}>
        {Object.entries(REASON_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </SelectField>
      <TextAreaField label="What it means" required error={e.meaning?.message} {...register("meaning")} />
      <TextAreaField label="What to check" required error={e.whatToCheck?.message} {...register("whatToCheck")} />
      <TextAreaField label="Required action" required error={e.requiredAction?.message} {...register("requiredAction")} />
      <FormActions>
        <ButtonLink href="/rejection-reasons" variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>Save</Button>
      </FormActions>
    </form>
  );
}
