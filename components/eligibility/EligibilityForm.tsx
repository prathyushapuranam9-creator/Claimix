"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import type { EligibilityHistoryItem, EligibilityOutcome } from "@/modules/eligibility/eligibility.service";
import { eligibilityInputSchema, type EligibilityInput } from "@/modules/eligibility/eligibility.validation";
import { workflowSteps } from "@/modules/eligibility/workflow";
import { RELATIONSHIPS, RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { FormGrid, FormSection, formStyles } from "@/components/ui/Form";
import { Alert, Card, Stack } from "@/components/ui/Surface";
import { WorkflowStepper } from "@/components/workflow/WorkflowStepper";
import { CaseDetailsFields } from "./CaseDetailsFields";
import { EligibilityHistory } from "./EligibilityHistory";
import { EligibilityResult } from "./EligibilityResult";

type Opt = { id: string; name: string };
type Coded = { id: string; code: string; name: string };

export function EligibilityForm({
  action,
  beneficiaryId,
  policies,
  hospitals,
  diagnoses,
  procedures,
  history,
}: {
  action: (i: EligibilityInput) => Promise<ActionResult<EligibilityOutcome>>;
  /** When set, policy/member details come from the recorded coverage. */
  beneficiaryId?: string;
  policies: (Opt & { category: string })[];
  /** Only for platform admins. */
  hospitals?: Opt[];
  diagnoses: Coded[];
  procedures: Coded[];
  /** Recorded checks for this coverage (only when checking a registered coverage). */
  history?: EligibilityHistoryItem[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<EligibilityOutcome | null>(null);
  const { register, handleSubmit, setError, formState, getValues } = useForm<EligibilityInput>({
    resolver: zodResolver(eligibilityInputSchema),
    defaultValues: { beneficiaryId, claimType: "cashless", isAccident: "unknown", pedDeclared: "unknown", pedRelated: "unknown" },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  const onSubmit = handleSubmit(async (v) => {
    const r = await action(v);
    if (apply(r)) {
      setResult(r.data);
      // Re-reads the recorded checks (no new evaluation is run) so this one joins the history.
      router.refresh();
      requestAnimationFrame(() => document.getElementById("eligibility-result")?.focus());
    }
  });

  const preauthHref = () => {
    if (!result?.beneficiaryId) return null;
    const v = getValues();
    const sp = new URLSearchParams({ beneficiary: result.beneficiaryId });
    for (const k of ["claimType", "diagnosisId", "procedureId", "admissionDate", "isAccident", "pedDeclared", "pedRelated", "estimatedCost", "roomRentPerDay"] as const) {
      const x = v[k];
      if (x !== undefined && x !== null && x !== "") sp.set(k, String(x));
    }
    return `/pre-authorizations/new?${sp.toString()}`;
  };

  return (
    <Stack>
      <Card>
        <form className={formStyles.form} onSubmit={onSubmit} noValidate>
          {formError && <Alert tone="danger">{formError}</Alert>}
          {!beneficiaryId && (
            <FormSection title="Policy or scheme" hint="Enter details exactly as on the insurance card or scheme record. Anything left blank will be flagged for verification, not assumed.">
              <FormGrid>
                <SelectField label="Insurance / scheme" required error={e.policyId?.message} {...register("policyId")}>
                  <option value="">Select…</option>
                  {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </SelectField>
                <TextField label="Policy / member ID" error={e.memberId?.message} {...register("memberId")} />
                <TextField label="Patient date of birth" type="date" error={e.dob?.message} {...register("dob")} />
                <SelectField label="Relationship to policyholder" error={e.relationship?.message} {...register("relationship")}>
                  <option value="">Select…</option>
                  {RELATIONSHIPS.map((r) => <option key={r} value={r}>{RELATIONSHIP_LABEL[r]}</option>)}
                </SelectField>
                <TextField label="Policy start date" type="date" error={e.coverStart?.message} {...register("coverStart")} />
                <TextField label="Policy end date" type="date" error={e.coverEnd?.message} {...register("coverEnd")} />
                <TextField label="First inception date" type="date" hint="With continuous renewals; used for waiting periods." error={e.inceptionDate?.message} {...register("inceptionDate")} />
                <TextField label="Sum insured (₹)" inputMode="decimal" error={e.sumInsured?.message} {...register("sumInsured")} />
                <TextField label="Available balance (₹)" inputMode="decimal" error={e.availableBalance?.message} {...register("availableBalance")} />
              </FormGrid>
            </FormSection>
          )}
          <FormSection title="Admission">
            <FormGrid>
              {hospitals && (
                <SelectField label="Hospital" required error={e.hospitalId?.message} {...register("hospitalId")}>
                  <option value="">Select hospital…</option>
                  {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </SelectField>
              )}
              <CaseDetailsFields register={register} errors={e} diagnoses={diagnoses} procedures={procedures} />
            </FormGrid>
          </FormSection>
          <div>
            <Button type="submit" loading={formState.isSubmitting}>Check eligibility</Button>
          </div>
        </form>
      </Card>

      {result && (
        <div id="eligibility-result" tabIndex={-1}>
          <Stack>
            <Card title="Workflow">
              <WorkflowStepper steps={workflowSteps({ evaluation: result.evaluation })} />
            </Card>
            <EligibilityResult evaluation={result.evaluation} policyName={result.policy.name} ruleVersion={result.ruleVersion} evaluationId={result.evaluationId} hospitalName={result.hospital.name} />
            {preauthHref() && result.evaluation.preauthRequired !== false && (
              <div>
                <ButtonLink href={preauthHref()!}>Start pre-authorization with these details</ButtonLink>
              </div>
            )}
          </Stack>
        </div>
      )}

      {history && <EligibilityHistory items={history} liveId={result?.evaluationId ?? null} />}
    </Stack>
  );
}
