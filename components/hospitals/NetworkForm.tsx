"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { NETWORK_STATUS_LABEL, NETWORK_STATUSES, networkInputSchema, type NetworkInput } from "@/modules/hospitals/hospitals.validation";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Checkbox, FormGrid, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

type Option = { id: string; name: string };

/** Admin form to record/verify a hospital's network or empanelment status with one payer. */
export function NetworkForm({
  action,
  insurers,
  tpas,
  schemes,
}: {
  action: (input: NetworkInput) => Promise<ActionResult>;
  insurers: Option[];
  tpas: Option[];
  schemes: Option[];
}) {
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, setError, control, reset, formState } = useForm<NetworkInput>({
    resolver: zodResolver(networkInputSchema),
    defaultValues: { payerType: "insurer", status: "network", cashlessAvailable: true },
  });
  const { formError, apply } = useServerResult(setError);
  const payerType = useWatch({ control, name: "payerType" });
  const options = payerType === "insurer" ? insurers : payerType === "tpa" ? tpas : schemes;
  const statuses = NETWORK_STATUSES.filter((s) => (payerType === "scheme" ? s !== "network" : s !== "empanelled"));
  const e = formState.errors;

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setSaved(false);
        if (apply(await action(v))) {
          setSaved(true);
          reset({ payerType: v.payerType, status: v.payerType === "scheme" ? "empanelled" : "network", cashlessAvailable: true, payerId: "" });
        }
      })}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      {saved && <Alert tone="success">Network status saved and verification date recorded.</Alert>}
      <FormGrid>
        <SelectField label="Payer type" error={e.payerType?.message} {...register("payerType")}>
          <option value="insurer">Insurance company</option>
          <option value="tpa">TPA</option>
          <option value="scheme">Government scheme</option>
        </SelectField>
        <SelectField label="Payer" required error={e.payerId?.message} {...register("payerId")}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </SelectField>
        <SelectField label="Status" error={e.status?.message} {...register("status")}>
          {statuses.map((s) => (
            <option key={s} value={s}>{NETWORK_STATUS_LABEL[s]}</option>
          ))}
        </SelectField>
        <Checkbox label="Cashless available" {...register("cashlessAvailable")} />
      </FormGrid>
      <div>
        <Button type="submit" variant="secondary" loading={formState.isSubmitting}>Save network status</Button>
      </div>
    </form>
  );
}
