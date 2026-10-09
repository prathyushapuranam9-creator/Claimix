"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { likelyRefusal, type Finding, type Scrutiny, type WizardDocument } from "@/modules/preauth/preauth.scrutiny";
import { gapsAcknowledgment, type PreauthDetailsInput, type QuickFixInput, type WizardKycInput } from "@/modules/preauth/preauth.validation";
import { Button } from "@/components/ui/Button";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, Stack, type Tone } from "@/components/ui/Surface";
import { KYC_FORM_ID, KycStep, type KycActions, type KycOptions } from "./KycStep";
import { CaseBanner, FormPanel, FullFormNote, WIZARD_STEPS, WizardFooter, WizardStepper, type StepState } from "./WizardChrome";
import { CLINICAL_FORM_ID, WizardClinicalForm } from "./WizardClinicalForm";
import { ChecksDashboard, type ClearedCheck } from "./ChecksDashboard";
import { SupportingDocuments } from "./SupportingDocuments";
import type { WizardFile } from "./WizardDropzone";
import styles from "./NewClaimWizard.module.css";

type Coded = { id: string; code: string; name: string };

/** Everything the wizard shows for a draft case, computed on the server (PreauthService.wizard). */
export interface WizardView {
  id: string;
  reference: string;
  status: string;
  editable: boolean;
  patientName: string;
  mobile: string | null;
  kyc: Partial<WizardKycInput>;
  /** The Aadhaar known for this case or patient, masked to its last 4 digits. */
  aadhaarOnFile: string | null;
  beneficiaryId: string;
  matched: string;
  kycOptions: KycOptions;
  details: PreauthDetailsInput;
  diagnoses: Coded[];
  procedures: Coded[];
  departments: string[];
  files: WizardFile[];
  requirements: WizardDocument[];
  policyHasDocumentRules: boolean;
  scrutiny: Scrutiny;
  /** Readiness checks that passed (the dashboard's Cleared Checks). */
  cleared: ClearedCheck[];
  evaluatedAt: string | null;
  ruleVersion: number | null;
  summary: [label: string, value: ReactNode][];
  nhcx: { connected: boolean; text: string };
  fullFormHref: string | null;
}

export interface WizardActions extends KycActions {
  saveClinical: (id: string, v: PreauthDetailsInput) => Promise<ActionResult>;
  upload: (id: string, fd: FormData) => Promise<ActionResult>;
  remove: (documentId: string) => Promise<ActionResult>;
  quickFix: (id: string, patch: QuickFixInput) => Promise<ActionResult>;
  runChecks: (id: string) => Promise<ActionResult>;
  confirmItem: (id: string, input: { key: string; confirmed: boolean; note?: string }) => Promise<ActionResult>;
  submit: (id: string, input: { acknowledged: boolean }) => Promise<ActionResult>;
}

const SEVERITY_TONE: Record<Finding["severity"], Tone> = { critical: "danger", high: "danger", medium: "warning", low: "warning" };
export function NewClaimWizard({ view, initialStep, actions }: { view: WizardView; initialStep: number; actions: WizardActions }) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([1, initialStep, ...(view.details.symptoms ? [2] : [])]));
  // Unsaved edits on the two form steps: kept while moving between steps, but they must be saved before submitting.
  const [dirty, setDirty] = useState<Record<1 | 2, boolean>>({ 1: false, 2: false });
  const [blocked, setBlocked] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = view.id;
  const ro = !view.editable;
  const gaps = view.scrutiny.findings;
  const critical = (n: number) => gaps.some((f) => likelyRefusal(f.severity) && f.step === n);
  const unsaved = ([1, 2] as const).filter((n) => dirty[n]);
  const detailsKey = hashKey(JSON.stringify(view.details));

  /** Opens a step. Every step stays mounted (only hidden), so nothing typed on another step is lost. */
  const go = (n: number) => {
    setBlocked(null);
    setStep(n);
    setVisited((v) => new Set(v).add(n));
    // The step is kept in the URL so a reload or a later visit resumes here.
    router.replace(`/pre-authorizations/raise?id=${id}&step=${n}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const states: StepState[] = WIZARD_STEPS.map((_, i) => {
    const n = i + 1;
    if (n === 5 || !visited.has(n)) return "upcoming";
    if (n === 4) return view.evaluatedAt ? (critical(4) ? "error" : "done") : "upcoming";
    return critical(n) || (n <= 2 && dirty[n as 1 | 2]) ? "error" : "done";
  });

  const canSubmit = !ro && unsaved.length === 0 && !!view.evaluatedAt && view.scrutiny.blocking === 0 && (gaps.length === 0 || ack);
  const submit = () => {
    setSubmitError(null);
    start(async () => {
      const r = await actions.submit(id, { acknowledged: ack });
      if (r.ok) router.push(`/pre-authorizations/${id}`);
      else {
        setSubmitError(r.error);
        router.refresh();
      }
    });
  };

  return (
    <FormPanel heading={<CaseBanner name={view.patientName} mobile={view.mobile} reference={view.reference} />}>
      <div className={styles.wizard}>
        {ro && (
          <Alert tone="info" title="This case has already been submitted">
            It can no longer be changed here. <Link href={`/pre-authorizations/${id}`}>Open the case</Link> to follow the payer&apos;s review.
          </Alert>
        )}
        <WizardStepper current={step} states={states} onGo={go} />
        <h2 className="visually-hidden">{WIZARD_STEPS[step - 1]}</h2>
        {blocked && <Alert tone="danger">{blocked}</Alert>}
        {unsaved.some((n) => n !== step) && (
          <Alert tone="warning" title="Unsaved changes">
            {unsaved.filter((n) => n !== step).map((n) => (
              <span key={n}>
                {WIZARD_STEPS[n - 1]} has changes that aren&apos;t saved yet.{" "}
                <Button type="button" size="sm" variant="ghost" onClick={() => go(n)}>Go to {WIZARD_STEPS[n - 1]}</Button>
              </span>
            ))}
          </Alert>
        )}

        <div hidden={step !== 1}>
          <KycStep
            caseId={id}
            defaults={view.kyc}
            beneficiaryId={view.beneficiaryId}
            matched={view.matched}
            options={view.kycOptions}
            aadhaarOnFile={view.aadhaarOnFile}
            actions={actions}
            disabled={ro}
            onDirty={(d) => setDirty((x) => (x[1] === d ? x : { ...x, 1: d }))}
            onDone={() => {
              router.refresh();
              go(2);
            }}
          />
        </div>

        <div hidden={step !== 2}>
          <Card>
            <WizardClinicalForm
              key={detailsKey}
              defaults={view.details}
              diagnoses={view.diagnoses}
              procedures={view.procedures}
              departments={view.departments}
              disabled={ro}
              onDirty={(d) => setDirty((x) => (x[2] === d ? x : { ...x, 2: d }))}
              save={(v) => actions.saveClinical(id, v)}
              onSaved={() => {
                // Register the Case: saved, then the case registration form opens on its own page.
                router.push(`/pre-authorizations/raise/register?id=${id}`);
              }}
            />
          </Card>
        </div>

        <div hidden={step !== 3}>
          <SupportingDocuments
            caseId={id}
            requirements={view.requirements}
            files={view.files}
            policyHasDocumentRules={view.policyHasDocumentRules}
            ro={ro}
            upload={actions.upload}
            remove={actions.remove}
          />
        </div>

        <div hidden={step !== 4}>
          <ChecksDashboard
            caseId={id}
            ro={ro}
            scrutiny={view.scrutiny}
            cleared={view.cleared}
            evaluatedAt={view.evaluatedAt}
            ruleVersion={view.ruleVersion}
            details={view.details}
            diagnoses={view.diagnoses}
            requirements={view.requirements}
            clinicalDirty={dirty[2]}
            actions={actions}
            onGo={go}
          />
        </div>

        <div hidden={step !== 5}>
          <Stack>
            <Card title="Summary">
              <Details columns={3} items={view.summary} />
            </Card>
            {unsaved.length > 0 && (
              <Alert tone="danger" title="Save your changes first">
                {unsaved.map((n) => WIZARD_STEPS[n - 1]).join(" and ")} {unsaved.length === 1 ? "has" : "have"} unsaved changes. Save them (Next on that step) before submitting.
              </Alert>
            )}
            {!view.evaluatedAt && (
              <Alert tone="danger" title="Run the checks first">
                The checks must run on the case as it is now before it is sent.{" "}
                <Button type="button" size="sm" variant="ghost" onClick={() => go(4)}>Go to AI Pre-Scrutiny &amp; Rules Engine</Button>
              </Alert>
            )}
            {view.scrutiny.blocking > 0 && (
              <Alert tone="danger" title="Complete Clinical Details & Package first">
                <ul>{gaps.filter((f) => f.key.startsWith("clinical:")).map((f) => <li key={f.key}>{f.explanation}</li>)}</ul>
                <Button type="button" size="sm" variant="ghost" onClick={() => go(2)}>Go to Clinical Details &amp; Package</Button>
              </Alert>
            )}
            {gaps.length > 0 && view.evaluatedAt && (
              <Alert tone="warning" title="Worth fixing before you send — the payer is likely to query these">
                <ul className={styles.gapList}>
                  {gaps.map((f) => (
                    <li key={f.key}>
                      <Badge tone={SEVERITY_TONE[f.severity]}>{likelyRefusal(f.severity) ? "Likely refusal" : "May query"}</Badge> {f.title}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {!ro && gaps.length > 0 && view.evaluatedAt && (
              <label className={styles.ack}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>{gapsAcknowledgment(gaps.length)}</span>
              </label>
            )}
            <Alert tone="info">
              {view.nhcx.text} Submitting places the case in the payer&apos;s review queue in Claimix on the hospital&apos;s behalf, and the hospital is notified. Approval is never
              guaranteed — the payer decides.
            </Alert>
            {submitError && <Alert tone="danger">{submitError}</Alert>}
          </Stack>
        </div>

        <WizardFooter info={<>Case <span className="mono">{view.reference}</span> · Step {step} of {WIZARD_STEPS.length}{unsaved.length ? " · unsaved changes" : " · saved to the server"}</>}>
          {step > 1 && <Button type="button" variant="secondary" onClick={() => go(step - 1)} disabled={pending}>Back</Button>}
          {step === 1 && (ro ? <Button type="button" onClick={() => go(2)}>Next</Button> : <Button type="submit" form={KYC_FORM_ID} disabled={pending}>Next</Button>)}
          {step === 2 && (ro ? <Button type="button" onClick={() => go(3)}>Next</Button> : <Button type="submit" form={CLINICAL_FORM_ID} disabled={pending}>Register the Case</Button>)}
          {(step === 3 || step === 4) && <Button type="button" onClick={() => go(step + 1)} disabled={pending}>Next</Button>}
          {step === 5 && !ro && (
            <Button type="button" onClick={submit} disabled={!canSubmit} loading={pending} variant={gaps.length ? "danger" : "primary"}>
              {view.nhcx.connected ? "Submit via NHCX" : "Submit to payer"}
            </Button>
          )}
        </WizardFooter>
        <FullFormNote href={view.fullFormHref} />
      </div>
    </FormPanel>
  );
}

/** A short stable key for a value (djb2), used to re-mount a form when its saved data changes. */
function hashKey(v: string): string {
  let h = 5381;
  for (let i = 0; i < v.length; i++) h = ((h << 5) + h + v.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
