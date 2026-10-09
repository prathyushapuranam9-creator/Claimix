"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/india";
import { DOCUMENT_TYPES } from "@/modules/documents/document-types";
import { SEVERITY_LABEL, TIER_LABEL, likelyRefusal, type Finding, type Scrutiny, type WizardDocument } from "@/modules/preauth/preauth.scrutiny";
import { gapsAcknowledgment, type PreauthDetailsInput, type WizardKycInput } from "@/modules/preauth/preauth.validation";
import { DocumentViewButton } from "@/components/documents/DocumentViewer";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, Stack, type Tone } from "@/components/ui/Surface";
import { KYC_FORM_ID, KycStep, type KycActions, type KycOptions } from "./KycStep";
import { CaseBanner, FormPanel, FullFormNote, WIZARD_STEPS, WizardFooter, WizardStepper, type StepState } from "./WizardChrome";
import { CLINICAL_FORM_ID, WizardClinicalForm } from "./WizardClinicalForm";
import { ACCEPT, checkFiles, WizardDropzone, type WizardFile } from "./WizardDropzone";
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
  evaluatedAt: string | null;
  ruleVersion: number | null;
  summary: [label: string, value: ReactNode][];
  nhcx: { connected: boolean; text: string };
  fullFormHref: string | null;
}

export interface WizardActions extends KycActions {
  saveClinical: (id: string, v: PreauthDetailsInput) => Promise<ActionResult>;
  runChecks: (id: string) => Promise<ActionResult>;
  confirmItem: (id: string, input: { key: string; confirmed: boolean; note?: string }) => Promise<ActionResult>;
  submit: (id: string, input: { acknowledged: boolean }) => Promise<ActionResult>;
}

const SEVERITY_TONE: Record<Finding["severity"], Tone> = { critical: "danger", high: "danger", medium: "warning", low: "warning" };
const CENTRAL_TYPES: [string, string][] = [
  ["doctor_consultation", "Doctor's note"],
  ["preauth_form", "Signed pre-auth form"],
  ["investigation_reports", "Investigation reports"],
  ["medical_history", "Previous consultation papers"],
  ["other", "The whole case as one PDF / other"],
];

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
  const filesOf = (types: string[]) => view.files.filter((f) => types.includes(f.docType));
  const critical = (n: number) => gaps.some((f) => likelyRefusal(f.severity) && f.step === n);
  const unsaved = ([1, 2] as const).filter((n) => dirty[n]);

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

  const confirm = (key: string, confirmed: boolean, note?: string) =>
    start(async () => {
      const r = await actions.confirmItem(id, { key, confirmed, note });
      if (!r.ok) setBlocked(r.error);
      router.refresh();
    });

  const runChecks = () =>
    start(async () => {
      const r = await actions.runChecks(id);
      setBlocked(r.ok ? null : r.error);
      router.refresh();
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
            files={view.files}
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
              defaults={view.details}
              diagnoses={view.diagnoses}
              procedures={view.procedures}
              departments={view.departments}
              disabled={ro}
              onDirty={(d) => setDirty((x) => (x[2] === d ? x : { ...x, 2: d }))}
              save={(v) => actions.saveClinical(id, v)}
              onSaved={() => {
                router.refresh();
                go(3);
              }}
            />
          </Card>
        </div>

        <div hidden={step !== 3}>
          <Papers view={view} actions={actions} ro={ro} filesOf={filesOf} />
        </div>

        <div hidden={step !== 4}>
          <Stack>
            {!view.evaluatedAt ? (
              <Alert tone="info" title="The scrutiny engine has not run on this case yet.">
                <p>
                  It checks the case against this policy&apos;s published rules, the policy record and the papers. The checks are deterministic — no AI model
                  decides anything here, and nothing approves or rejects the case: the payer decides.
                </p>
                {!ro && <p><Button type="button" onClick={runChecks} loading={pending}>Run Checks</Button></p>}
              </Alert>
            ) : (
              <>
                <div className={styles.checksBanner} data-tone={view.scrutiny.refuse ? "danger" : view.scrutiny.query ? "warning" : "success"} role="status">
                  <div>
                    <strong data-testid="checks-headline">
                      {view.scrutiny.refuse} the payer is likely to refuse over, and {view.scrutiny.query} it may query
                    </strong>
                    <span className={styles.muted}>
                      Checked {formatDateTime(view.evaluatedAt)}{view.ruleVersion !== null ? ` · policy rules version ${view.ruleVersion}` : " · this policy has no published rules"}
                    </span>
                  </div>
                  {!ro && <Button type="button" variant="secondary" onClick={runChecks} loading={pending}>Run Checks Again</Button>}
                </div>
                {gaps.length === 0 ? (
                  <Alert tone="success" title="Nothing found">The checks found nothing the payer is likely to refuse or query.</Alert>
                ) : (
                  <ul className={styles.findings} aria-label="Findings">
                    {gaps.map((f) => <FindingCard key={f.key} f={f} ro={ro} pending={pending} onGo={go} onConfirm={confirm} />)}
                  </ul>
                )}
              </>
            )}
          </Stack>
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

/** Step 3: the checklist of papers with per-row Upload (and Print for the form), plus a central dropzone. */
function Papers({ view, actions, ro, filesOf }: { view: WizardView; actions: WizardActions; ro: boolean; filesOf: (types: string[]) => WizardFile[] }) {
  const router = useRouter();
  const [central, setCentral] = useState("doctor_consultation");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const baseId = useId();

  const uploadAs = (docType: string, list: File[]) => {
    const bad = checkFiles(list);
    if (bad) return setMsg({ tone: "danger", text: bad });
    start(async () => {
      const failed: string[] = [];
      for (const f of list) {
        const fd = new FormData();
        fd.set("docType", docType);
        fd.set("file", f);
        const r = await actions.upload(view.id, fd);
        if (!r.ok) failed.push(`${f.name}: ${r.error}`);
      }
      setMsg(failed.length ? { tone: "danger", text: failed.join(" ") } : { tone: "success", text: `${DOCUMENT_TYPES[docType]?.label ?? "Document"} uploaded.` });
      router.refresh();
    });
  };

  return (
    <Stack>
      <Card title="Supporting documents">
        <p className={styles.muted}>
          {view.policyHasDocumentRules
            ? "The standard cashless papers, raised where this policy's published document rules ask for more."
            : "The standard cashless papers (this policy has no published document rules)."}
        </p>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <ul className={styles.reqList} aria-label="Document checklist">
          {view.requirements.map((r, i) => {
            const mine = filesOf(r.accepts);
            const inputId = `${baseId}-${i}`;
            return (
              <li key={r.type} className={styles.req} data-missing={r.tier === "must" && r.uploaded === 0 ? "true" : undefined} data-doc={r.type}>
                <span className={styles.tier} data-tier={r.tier}>{TIER_LABEL[r.tier]}</span>
                <div>
                  <div className={styles.reqName}>{r.label}</div>
                  <div className={styles.muted}>{r.uploaded > 0 ? `Uploaded (${mine.length})` : "Not uploaded"}{r.source === "policy_rules" && " · policy rule"}</div>
                  {mine.length > 0 && (
                    <ul className={styles.files}>
                      {mine.map((f) => (
                        <li key={f.id} className={styles.file}>
                          <span>{f.originalName}</span>
                          <span className={styles.fileActions}>
                            {f.scanStatus === "clean" && <DocumentViewButton id={f.id} name={f.originalName} />}
                            {!ro && f.status !== "verified" && (
                              <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${f.originalName}`} disabled={pending} onClick={() => start(async () => {
                                const x = await actions.remove(f.id);
                                setMsg(x.ok ? { tone: "success", text: `${f.originalName} removed.` } : { tone: "danger", text: x.error });
                                router.refresh();
                              })}>Remove</Button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className={styles.rowActions}>
                  {r.printable && <ButtonLink href={`/pre-authorizations/raise/print?id=${view.id}`} variant="secondary" size="sm">Print</ButtonLink>}
                  {!ro && (
                    <label htmlFor={inputId} className={styles.uploadButton} aria-disabled={pending || undefined}>
                      Upload
                      <input id={inputId} type="file" accept={ACCEPT} multiple disabled={pending} aria-label={`Upload: ${r.label}`} onChange={(e) => { uploadAs(r.type, [...(e.target.files ?? [])]); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {!ro && (
        <Card title="Doctor's Note / Signed Form">
          <div className={styles.centralRow}>
            <SelectField label="File as" value={central} onChange={(e) => setCentral(e.target.value)}>
              {CENTRAL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
          </div>
          <WizardDropzone title="Doctor's Note / Signed Form" hint="Reports too — or the whole case as one PDF" docType={central} upload={(fd) => actions.upload(view.id, fd)} />
        </Card>
      )}
    </Stack>
  );
}

function FindingCard({ f, ro, pending, onGo, onConfirm }: { f: Finding; ro: boolean; pending: boolean; onGo: (n: number) => void; onConfirm: (key: string, confirmed: boolean, note?: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <li className={styles.finding} data-severity={f.severity} data-finding={f.key}>
      <div className={styles.findingHead}>
        <Badge tone={SEVERITY_TONE[f.severity]}>{likelyRefusal(f.severity) ? "Likely refusal" : "May query"} · {SEVERITY_LABEL[f.severity]}</Badge>
        <span>{f.title}</span>
      </div>
      <dl className={styles.findingBody}>
        <dt>Why</dt>
        <dd>{f.explanation}</dd>
        <dt>What to do</dt>
        <dd>{f.resolution}</dd>
      </dl>
      {!ro && (
        <div className={styles.inline}>
          {f.confirmItem && f.needsNote && (
            <>
              <TextField label="Verification note" placeholder="Who confirmed it with the payer, and how" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="button" size="sm" disabled={pending || note.trim().length < 10} onClick={() => onConfirm(f.confirmItem!, true, note)}>Record verification</Button>
            </>
          )}
          {f.confirmItem && !f.needsNote && <Button type="button" size="sm" disabled={pending} onClick={() => onConfirm(f.confirmItem!, true)}>Confirm</Button>}
          {f.step !== 4 && <Button type="button" size="sm" variant="secondary" onClick={() => onGo(f.step)}>Go to {WIZARD_STEPS[f.step - 1]}</Button>}
        </div>
      )}
    </li>
  );
}
