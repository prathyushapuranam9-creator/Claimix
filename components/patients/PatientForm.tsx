"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { patientInputSchema, type PatientInput } from "@/modules/patients/patients.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FormActions, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";
import { PatientFields } from "./PatientFields";

interface Props {
  action: (input: PatientInput) => Promise<ActionResult>;
  defaults?: Partial<PatientInput>;
  /** Only provided for platform admins, who must choose the registering hospital. */
  hospitals?: { id: string; name: string }[];
  cancelHref: string;
  submitLabel: string;
}

export function PatientForm({ action, defaults, hospitals, cancelHref, submitLabel }: Props) {
  const { register, handleSubmit, setError, formState } = useForm<PatientInput>({
    resolver: zodResolver(patientInputSchema),
    defaultValues: { gender: "undisclosed", ...defaults },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  // Existing records the server found with the same name and date of birth (a warning the user can confirm).
  const [duplicates, setDuplicates] = useState<{ id: string; patientNo: string }[]>([]);

  const submit = (confirmDuplicate: boolean) =>
    handleSubmit(async (v) => {
      const r = await action(confirmDuplicate ? { ...v, confirmDuplicate: true } : v);
      const found = !r.ok ? r.fieldErrors?._duplicate : undefined;
      if (found?.length) {
        setDuplicates(found.map((x) => ({ id: x.split("|")[0]!, patientNo: x.split("|")[1] ?? "" })));
        return;
      }
      setDuplicates([]);
      apply(r);
    });

  return (
    <form className={formStyles.form} onSubmit={submit(false)} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      {duplicates.length > 0 && (
        <Alert tone="warning" title="This patient may already be registered">
          <p>
            A patient with the same name and date of birth is already registered at this hospital:{" "}
            {duplicates.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <Link href={`/patients/${d.id}`} target="_blank" rel="noopener noreferrer">{d.patientNo}</Link>
              </span>
            ))}
            . Open the existing record to avoid a duplicate, or register this person as a separate patient if they are not the same individual.
          </p>
          <FormActions>
            <Button type="button" variant="secondary" loading={formState.isSubmitting} onClick={() => void submit(true)()}>
              Register as a new patient anyway
            </Button>
          </FormActions>
        </Alert>
      )}
      <PatientFields register={(n) => register(n)} errorFor={(n) => e[n]?.message as string | undefined} hospitals={hospitals} />
      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}
