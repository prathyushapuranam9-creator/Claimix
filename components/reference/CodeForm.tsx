"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { diagnosisInputSchema, procedureInputSchema, type DiagnosisInput } from "@/modules/clinical/clinical.validation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { FormGrid, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

/** Adds one diagnosis or procedure code; the list refreshes after saving. */
export function CodeForm({ kind, action }: { kind: "diagnosis" | "procedure"; action: (input: DiagnosisInput) => Promise<ActionResult> }) {
  const router = useRouter();
  const { register, handleSubmit, setError, reset, formState } = useForm<DiagnosisInput>({
    resolver: zodResolver(kind === "diagnosis" ? diagnosisInputSchema : procedureInputSchema),
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  return (
    <form
      className={formStyles.form}
      onSubmit={handleSubmit(async (v) => {
        if (apply(await action(v))) {
          reset({ code: "", name: "" });
          router.refresh();
        }
      })}
      noValidate
      aria-label={kind === "diagnosis" ? "Add diagnosis code" : "Add procedure code"}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormGrid>
        <TextField label="Code" required hint={kind === "diagnosis" ? "ICD-10, e.g. K35" : "e.g. LAP-CHOLE"} error={e.code?.message} {...register("code")} />
        <TextField label="Name" required error={e.name?.message} {...register("name")} />
      </FormGrid>
      <div>
        <Button type="submit" variant="secondary" loading={formState.isSubmitting}>
          {kind === "diagnosis" ? "Add diagnosis" : "Add procedure"}
        </Button>
      </div>
    </form>
  );
}
