"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import type { EligibilityHistoryItem, EligibilityOutcome } from "@/modules/eligibility/eligibility.service";
import { eligibilityInputSchema, type EligibilityInput } from "@/modules/eligibility/eligibility.validation";
import { workflowSteps } from "@/modules/eligibility/workflow";
import { coverPeriodStatus, RELATIONSHIPS, RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { FormGrid, FormSection, formStyles } from "@/components/ui/Form";
import { Alert, Card, Stack } from "@/components/ui/Surface";
import { WorkflowStepper } from "@/components/workflow/WorkflowStepper";
import { CaseDetailsFields } from "./CaseDetailsFields";
import { EligibilityHistory } from "./EligibilityHistory";
import { EligibilityBanner, EligibilityDetails } from "./EligibilityResult";

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
  next,
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
  /**
   * What this user may start from a result on recorded coverage, and where to fix the coverage when
   * the result doesn't allow a request. Absent for checks that aren't against a recorded coverage.
   */
  next?: { preauth: boolean; claim: boolean; patientHref: string; coverageEditHref: string };
}) {
  const router = useRouter();
  const [result, setResult] = useState<EligibilityOutcome | null>(null);
  // The result is a one-line outcome; the checks behind it open only on request.
  const [showDetails, setShowDetails] = useState(false);
  const { register, handleSubmit, setError, formState, getValues, control, reset } = useForm<EligibilityInput>({
    resolver: zodResolver(eligibilityInputSchema),
    defaultValues: { beneficiaryId, claimType: "cashless", isAccident: "unknown", pedDeclared: "unknown", pedRelated: "unknown" },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  // What was entered is kept (per coverage) for this browser tab, so changing one detail and checking again,
  // or coming back to the page, never means re-entering everything.
  const draftKey = `claimix.eligibility.draft.${beneficiaryId ?? "new"}`;
  const entered = useWatch({ control });
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) reset({ ...getValues(), ...(JSON.parse(saved) as Partial<EligibilityInput>), beneficiaryId });
    } catch {
      // Storage unavailable: the form simply starts empty.
    }
  }, [draftKey, beneficiaryId, getValues, reset]);
  const edited = formState.isDirty;
  useEffect(() => {
    // Only what the user has changed is kept (never the untouched defaults over an earlier draft).
    if (!edited) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify(entered)); } catch { /* not kept */ }
  }, [draftKey, entered, edited]);

  const onSubmit = handleSubmit(async (v) => {
    const r = await action(v);
    if (apply(r)) {
      setResult(r.data);
      setShowDetails(false);
      // Re-reads the recorded checks (no new evaluation is run) so this one joins the history.
      router.refresh();
      requestAnimationFrame(() => document.getElementById("eligibility-result")?.focus());
    }
  });

  const caseParams = () => {
    const v = getValues();
    const sp = new URLSearchParams({ beneficiary: result!.beneficiaryId! });
    for (const k of ["claimType", "diagnosisId", "procedureId", "admissionDate", "isAccident", "pedDeclared", "pedRelated", "estimatedCost", "roomRentPerDay"] as const) {
      const x = v[k];
      if (x !== undefined && x !== null && x !== "") sp.set(k, String(x));
    }
    return sp.toString();
  };

  const preauthHref = () => (result?.beneficiaryId ? `/pre-authorizations/new?${caseParams()}` : null);
  // A request can only be raised on cover that is in force today; the server refuses otherwise.
  const cover = result?.facts.cover;
  const coverPeriod = cover?.start && cover.end ? coverPeriodStatus({ coverStart: cover.start, coverEnd: cover.end }, result!.facts.asOf) : null;

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
            <EligibilityBanner
              evaluation={result.evaluation}
              policyName={result.policy.name}
              ruleVersion={result.ruleVersion}
              evaluationId={result.evaluationId}
              hospitalName={result.hospital.name}
              actions={
                <>
                  <Button type="button" size="sm" variant="secondary" aria-expanded={showDetails} aria-controls="eligibility-details" onClick={() => setShowDetails((v) => !v)}>
                    {showDetails ? "Hide details" : "View details"}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" loading={formState.isSubmitting} onClick={() => void onSubmit()}>
                    Check again
                  </Button>
                </>
              }
            />
            {showDetails && (
              <div id="eligibility-details">
                <Stack>
                  <Card title="Workflow">
                    <WorkflowStepper steps={workflowSteps({ evaluation: result.evaluation })} />
                  </Card>
                  <EligibilityDetails evaluation={result.evaluation} />
                </Stack>
              </div>
            )}
            {result.beneficiaryId && next && coverPeriod !== "in_force" && (
              <Alert tone="warning" title={coverPeriod === "expired" ? "This cover has ended" : "This cover has not started yet"}>
                <p>A pre-authorization or claim can&apos;t be raised on it. Correct the recorded cover, or record the cover the patient is insured under today.</p>
                <p>
                  <ButtonLink href={next.coverageEditHref} variant="secondary">Review / edit coverage</ButtonLink>{" "}
                  <ButtonLink href={next.patientHref} variant="ghost">Open patient</ButtonLink>
                </p>
              </Alert>
            )}
            {result.beneficiaryId && coverPeriod === "in_force" && result.evaluation.overall !== "FAIL" && (
              <Card title="Next step">
                <p>
                  {next
                    ? "The actions below carry this patient, this coverage and the case details you entered."
                    : "Pre-authorizations and claims are raised by the treating hospital's staff."}
                </p>
                {next && (
                  <p>
                    {next.preauth && result.evaluation.preauthRequired !== false && <ButtonLink href={preauthHref()!}>New pre-authorization</ButtonLink>}{" "}
                    {next.claim && <ButtonLink href={`/claims/new?beneficiary=${result.beneficiaryId}`} variant="secondary">New claim</ButtonLink>}
                  </p>
                )}
              </Card>
            )}
            {result.beneficiaryId && coverPeriod === "in_force" && result.evaluation.overall === "FAIL" && next && (
              <Alert tone="danger" title="A policy rule failed for this case">
                <p>
                  This case can&apos;t be treated as covered on the recorded information. Review the failed checks above, correct the coverage if the
                  details are wrong, or check another of the patient&apos;s policies.
                </p>
                <p>
                  <ButtonLink href={next.coverageEditHref} variant="secondary">Review / edit coverage</ButtonLink>{" "}
                  <ButtonLink href={next.patientHref} variant="ghost">Open patient</ButtonLink>
                </p>
              </Alert>
            )}
            {!result.beneficiaryId && result.evaluation.preauthRequired !== false && (
              <p>Register the patient and record this coverage to raise a pre-authorization from it.</p>
            )}
          </Stack>
        </div>
      )}

      {history && <EligibilityHistory items={history} />}
    </Stack>
  );
}
