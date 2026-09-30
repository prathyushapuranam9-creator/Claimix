"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { formatINR } from "@/lib/india";
import { useServerResult } from "@/lib/use-action-form";
import { settlementSchema, type SettlementInput } from "@/modules/claims/claims.validation";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { FormGrid, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

/** Records the actual payment. The amount can't exceed the approved amount (checked on the server too). */
export function SettlementForm({ action, approved, payee, today }: { action: (i: SettlementInput) => Promise<ActionResult>; approved: string | null; payee: string; today: string }) {
  const router = useRouter();
  const { register, handleSubmit, setError, formState } = useForm<SettlementInput>({
    resolver: zodResolver(settlementSchema),
    defaultValues: { amount: approved ?? "", settledAt: today },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  return (
    <form className={formStyles.form} noValidate onSubmit={handleSubmit(async (v) => { if (apply(await action(v))) router.refresh(); })}>
      <Alert tone="info">Approved: {formatINR(approved)} · paid to the {payee}. Record only a payment that has actually been made.</Alert>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormGrid>
        <TextField label="Amount paid (₹)" inputMode="decimal" required error={e.amount?.message} {...register("amount")} />
        <TextField label="Payment date" type="date" required error={e.settledAt?.message} {...register("settledAt")} />
        <TextField label="UTR / payment reference" required error={e.utr?.message} {...register("utr")} />
        <FullWidth><TextAreaField label="Deductions (if paid less than approved)" hint="e.g. TDS, recovery of an earlier advance." error={e.deductionNote?.message} {...register("deductionNote")} /></FullWidth>
      </FormGrid>
      <div><Button type="submit" loading={formState.isSubmitting}>Record settlement</Button></div>
    </form>
  );
}
