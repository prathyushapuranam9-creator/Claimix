"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { schemeInputSchema, type SchemeInput } from "@/modules/schemes/schemes.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { FormActions, FormGrid, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

export function SchemeForm({ action }: { action: (input: SchemeInput) => Promise<ActionResult> }) {
  const { register, handleSubmit, setError, formState } = useForm<SchemeInput>({ resolver: zodResolver(schemeInputSchema) });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  return (
    <form className={formStyles.form} onSubmit={handleSubmit(async (v) => apply(await action(v)))} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormGrid>
        <TextField label="Scheme name" required error={e.name?.message} {...register("name")} />
        <TextField label="Short code" required hint="Unique, e.g. STATE-HS" error={e.code?.message} {...register("code")} />
        <FullWidth>
          <TextField label="Administering authority" required error={e.authority?.message} {...register("authority")} />
        </FullWidth>
        <FullWidth>
          <TextAreaField label="Description" rows={3} maxLength={1000} error={e.description?.message} {...register("description")} />
        </FullWidth>
      </FormGrid>
      <FormActions>
        <ButtonLink href="/schemes" variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>Add scheme</Button>
      </FormActions>
    </form>
  );
}
