"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { DOCUMENT_TYPES } from "@/modules/documents/document-types";
import { claimDecisionSchema, type ClaimDecisionInput } from "@/modules/claims/claims.validation";
import { CLAIM_STATUS_LABEL } from "@/modules/claims/claims.workflow";
import { decisionSchema, type DecisionInput } from "@/modules/preauth/preauth.validation";
import { STATUS_LABEL } from "@/modules/preauth/preauth.workflow";
import { Button } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormGrid, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

type Reason = { id: string; title: string; kind: string };

const VERB: Record<string, string> = {
  pending: "Mark as under review",
  query: "Raise a query",
  approved: "Approve",
  partially_approved: "Partially approve",
  rejected: "Reject",
  final_approved: "Final approval",
};

type Result = Promise<ActionResult>;

/** Payer decision form for pre-auths and claims. Options are the transitions the server says this user may make. */
export function DecisionPanel({
  mode = "preauth",
  action,
  options,
  reasons,
  requested,
  schemeDesk,
}: {
  mode?: "preauth" | "claim";
  action: ((i: DecisionInput) => Result) | ((i: ClaimDecisionInput) => Result);
  options: string[];
  reasons: Reason[];
  requested: string | null;
  schemeDesk: boolean;
}) {
  const LABEL: Record<string, string> = mode === "claim" ? CLAIM_STATUS_LABEL : STATUS_LABEL;
  const send = action as (i: DecisionInput) => Result;
  const router = useRouter();
  const [done, setDone] = useState<string | null>(null);
  const { register, handleSubmit, setError, control, reset, formState } = useForm<DecisionInput>({
    resolver: zodResolver(mode === "claim" ? (claimDecisionSchema as unknown as typeof decisionSchema) : decisionSchema),
    defaultValues: { to: options[0] as DecisionInput["to"], requiredDocuments: [] },
  });
  const { formError, apply } = useServerResult(setError);
  const to = useWatch({ control, name: "to" });
  const needsReason = to === "query" || to === "rejected";
  const needsAmount = to === "approved" || to === "partially_approved" || to === "final_approved";
  const e = formState.errors;
  const reasonList = reasons.filter((r) => r.kind === "both" || r.kind === (to === "query" ? "query" : "rejection"));

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setDone(null);
        if (apply(await send(v))) {
          setDone(`Recorded: ${LABEL[v.to]}.`);
          reset({ to: options[0] as DecisionInput["to"], requiredDocuments: [] });
          router.refresh();
        }
      })}
    >
      {schemeDesk && (
        <Alert tone="info" title="Recording a scheme decision">
          Record the decision exactly as issued by the scheme, with the scheme&apos;s reference number. This platform does not make scheme decisions.
        </Alert>
      )}
      {formError && <Alert tone="danger">{formError}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      <FormGrid>
        <SelectField label="Decision" error={e.to?.message} {...register("to")}>
          {options.map((o) => <option key={o} value={o}>{VERB[o] ?? LABEL[o]}</option>)}
        </SelectField>
        {needsAmount && (
          <TextField label="Approved amount (₹)" inputMode="decimal" hint={requested ? `Requested: ₹${Number(requested).toLocaleString("en-IN")}` : undefined} error={e.amount?.message} {...register("amount")} />
        )}
        {needsReason && (
          <SelectField label="Reason" required error={e.reasonId?.message} {...register("reasonId")}>
            <option value="">Select reason…</option>
            {reasonList.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </SelectField>
        )}
        {(schemeDesk || to !== "pending") && (
          <TextField label={schemeDesk ? "Scheme reference no." : "Payer reference (optional)"} required={schemeDesk} error={e.payerReference?.message} {...register("payerReference")} />
        )}
        {to === "query" && (
          <FullWidth>
            <SelectField label="Documents requested" multiple size={5} hint="Hold Ctrl / Cmd to choose several." {...register("requiredDocuments")}>
              {Object.entries(DOCUMENT_TYPES).map(([t, d]) => <option key={t} value={t}>{d.label}</option>)}
            </SelectField>
          </FullWidth>
        )}
        <FullWidth>
          <TextAreaField label={needsReason ? "Message to the hospital" : "Remarks"} required={needsReason || to === "partially_approved"} error={e.message?.message} {...register("message")} />
        </FullWidth>
      </FormGrid>
      <div>
        <Button type="submit" variant={to === "rejected" ? "danger" : "primary"} loading={formState.isSubmitting}>{VERB[to] ?? "Record"}</Button>
      </div>
    </form>
  );
}
