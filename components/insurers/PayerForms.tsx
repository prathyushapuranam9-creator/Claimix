"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { insurerInputSchema, tpaInputSchema, type InsurerInput, type TpaInput } from "@/modules/insurers/insurers.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { FormActions, FormGrid, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

interface Props<T> {
  action: (input: T) => Promise<ActionResult>;
  defaults?: Partial<T>;
  cancelHref: string;
  submitLabel: string;
}

export function InsurerForm({ action, defaults, cancelHref, submitLabel }: Props<InsurerInput>) {
  const { register, handleSubmit, setError, formState } = useForm<InsurerInput>({ resolver: zodResolver(insurerInputSchema), defaultValues: defaults });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  return (
    <form className={formStyles.form} onSubmit={handleSubmit(async (v) => apply(await action(v)))} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormGrid>
        <TextField label="Insurer name" required error={e.name?.message} {...register("name")} />
        <TextField label="Short code" required hint="Unique, e.g. ABC-GEN" error={e.code?.message} {...register("code")} />
        <TextField label="Claims helpline" type="tel" error={e.claimsPhone?.message} {...register("claimsPhone")} />
        <TextField label="Claims email" type="email" error={e.claimsEmail?.message} {...register("claimsEmail")} />
        <TextField label="Website" type="url" placeholder="https://" error={e.website?.message} {...register("website")} />
      </FormGrid>
      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}

export function TpaForm({ action, defaults, cancelHref, submitLabel }: Props<TpaInput>) {
  const { register, handleSubmit, setError, formState } = useForm<TpaInput>({ resolver: zodResolver(tpaInputSchema), defaultValues: defaults });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  return (
    <form className={formStyles.form} onSubmit={handleSubmit(async (v) => apply(await action(v)))} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormGrid>
        <TextField label="TPA name" required error={e.name?.message} {...register("name")} />
        <TextField label="Short code" required hint="Unique, e.g. XYZ-TPA" error={e.code?.message} {...register("code")} />
        <TextField label="Phone" type="tel" error={e.phone?.message} {...register("phone")} />
        <TextField label="Email" type="email" error={e.email?.message} {...register("email")} />
      </FormGrid>
      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}
