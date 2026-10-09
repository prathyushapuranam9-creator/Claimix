"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/india";
import { likelyRefusal, SEVERITY_LABEL, type Finding, type Scrutiny, type WizardDocument } from "@/modules/preauth/preauth.scrutiny";
import type { PreauthDetailsInput, QuickFixInput } from "@/modules/preauth/preauth.validation";
import { Button } from "@/components/ui/Button";
import { ComboBox } from "@/components/ui/ComboBox";
import { DateTimePicker, type DateTimeValue } from "@/components/ui/DateTimePicker";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Alert, Badge, type Tone } from "@/components/ui/Surface";
import { ChronicIllnessInput } from "./WizardClinicalForm";
import { ACCEPT, checkFiles } from "./WizardDropzone";
import { WIZARD_STEPS } from "./steps";
import styles from "./NewClaimWizard.module.css";

type Coded = { id: string; code: string; name: string };

/** A readiness check that passed (shown under Cleared Checks). */
export interface ClearedCheck {
  key: string;
  label: string;
  detail: string;
  step: 1 | 2 | 3 | 4;
}

type Tab = "all" | "refuse" | "query" | "cleared";
const SEVERITY_TONE: Record<Finding["severity"], Tone> = { critical: "danger", high: "danger", medium: "warning", low: "warning" };

/** Risk level from the engine's own results: any likely refusal → High; only queries → Medium; nothing open → Low. */
export function riskLevel(s: Pick<Scrutiny, "refuse" | "query">): "High" | "Medium" | "Low" {
  return s.refuse > 0 ? "High" : s.query > 0 ? "Medium" : "Low";
}

/**
 * AI Pre-Scrutiny & Rules Engine as an executive dashboard. Everything shown comes from the existing scrutiny (policy
 * rules + readiness checklist + completeness checks): a risk summary, severity tabs, findings grouped by the form step
 * they belong to, and quick fixes that save through the same actions as the form steps. A fix changes the case, so
 * the engine asks to be re-run for updated results.
 */
export function ChecksDashboard({
  caseId,
  ro,
  scrutiny,
  cleared,
  evaluatedAt,
  ruleVersion,
  details,
  diagnoses,
  requirements,
  clinicalDirty,
  actions,
  onGo,
}: {
  caseId: string;
  ro: boolean;
  scrutiny: Scrutiny;
  cleared: ClearedCheck[];
  evaluatedAt: string | null;
  ruleVersion: number | null;
  details: PreauthDetailsInput;
  diagnoses: Coded[];
  requirements: WizardDocument[];
  clinicalDirty: boolean;
  actions: {
    runChecks: (id: string) => Promise<ActionResult>;
    confirmItem: (id: string, input: { key: string; confirmed: boolean; note?: string }) => Promise<ActionResult>;
    quickFix: (id: string, patch: QuickFixInput) => Promise<ActionResult>;
    upload: (id: string, fd: FormData) => Promise<ActionResult>;
  };
  onGo: (step: number) => void;
}) {
  const router = useRouter();
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>("all");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const findings = scrutiny.findings;
  const refuse = findings.filter((f) => likelyRefusal(f.severity));
  const query = findings.filter((f) => !likelyRefusal(f.severity));
  const risk = riskLevel(scrutiny);

  const run = () =>
    start(async () => {
      const r = await actions.runChecks(caseId);
      setError(r.ok ? null : r.error);
      router.refresh();
    });

  /** Runs a quick fix, then refreshes the case (the counts follow the saved data). */
  const fix = (fn: () => Promise<ActionResult>) =>
    new Promise<string | null>((resolve) =>
      start(async () => {
        const r = await fn();
        router.refresh();
        resolve(r.ok ? null : r.error);
      }),
    );
  const saveClinical = (patch: QuickFixInput) => fix(() => actions.quickFix(caseId, patch));

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All Alerts", count: findings.length },
    { key: "refuse", label: "Critical / Likely Refusal", count: refuse.length },
    { key: "query", label: "Queries & Warnings", count: query.length },
    { key: "cleared", label: "Cleared Checks", count: cleared.length },
  ];
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    setTab(next.key);
    document.getElementById(`${tabsId}-${next.key}`)?.focus();
  };

  // Group the tab's items by the form step they belong to.
  const groups = (items: { step: number; node: ReactNode; key: string }[]) => {
    const steps = [...new Set(items.map((i) => i.step))].sort((a, b) => a - b);
    return steps.map((st) => {
      const own = items.filter((i) => i.step === st);
      return (
        <details key={st} className={styles.findingGroup} open data-step={st}>
          <summary>
            <span className={styles.docGroupTitle}>{WIZARD_STEPS[st - 1]}</span>
            <span className={styles.docGroupCount}>{own.length} {tab === "cleared" ? (own.length === 1 ? "check" : "checks") : own.length === 1 ? "issue" : "issues"}</span>
          </summary>
          <ul className={styles.findings} aria-label={`${WIZARD_STEPS[st - 1]} ${tab === "cleared" ? "checks" : "findings"}`}>
            {own.map((i) => <li key={i.key} className={styles.findingItem}>{i.node}</li>)}
          </ul>
        </details>
      );
    });
  };

  const list = tab === "refuse" ? refuse : tab === "query" ? query : findings;
  return (
    <div className={styles.dashboard}>
      <div className={styles.riskBanner} data-risk={risk} role="status">
        <div className={styles.riskMain}>
          <span className={styles.riskLabel}>Risk Level</span>
          <strong className={styles.riskValue} data-testid="risk-level">{risk}</strong>
          <span className={styles.muted}>
            {evaluatedAt
              ? `Engine run ${formatDateTime(evaluatedAt)}${ruleVersion !== null ? ` · policy rules version ${ruleVersion}` : " · this policy has no published rules"}`
              : "The scrutiny engine has not run on this case yet."}
          </span>
        </div>
        <dl className={styles.riskStats}>
          <div><dt>Critical / Likely Refusal</dt><dd data-testid="count-refuse">{refuse.length}</dd></div>
          <div><dt>Queries / Warnings</dt><dd data-testid="count-query">{query.length}</dd></div>
          <div><dt>Cleared Checks</dt><dd data-testid="count-cleared">{cleared.length}</dd></div>
        </dl>
        {!ro && (
          <Button type="button" onClick={run} loading={pending} className={styles.riskRun}>
            {evaluatedAt ? "Re-run Engine" : "Run Engine"}
          </Button>
        )}
      </div>
      <p className={styles.muted}>
        <span data-testid="checks-headline">{refuse.length} the payer is likely to refuse over, and {query.length} it may query</span>. The checks are deterministic
        — this policy&apos;s published rules, the readiness checklist and completeness of the case; no AI model decides anything, and the payer makes the decision.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {clinicalDirty && !ro && (
        <Alert tone="warning">Clinical Details &amp; Package has unsaved changes, so its quick fixes are paused. Save that step first.</Alert>
      )}

      <div role="tablist" aria-label="Findings by severity" className={styles.tabs}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            id={`${tabsId}-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            className={styles.tab}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label} <span className={styles.tabCount}>{t.count}</span>
          </button>
        ))}
      </div>
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} className={styles.tabPanel}>
        {tab === "cleared" ? (
          cleared.length === 0 ? (
            <p className={styles.muted}>{evaluatedAt ? "No checks have cleared yet." : "Run the engine to see which checks clear."}</p>
          ) : (
            groups(cleared.map((c) => ({
              key: c.key,
              step: c.step,
              node: (
                <div className={styles.finding} data-severity="cleared" data-finding={c.key}>
                  <div className={styles.findingHead}><Badge tone="success">Cleared</Badge><span>{c.label}</span></div>
                  {c.detail && <p className={styles.findingNote}>{c.detail}</p>}
                </div>
              ),
            })))
          )
        ) : list.length === 0 ? (
          <Alert tone="success" title="Nothing here">{tab === "all" ? "The checks found nothing the payer is likely to refuse or query." : "No findings of this severity."}</Alert>
        ) : (
          groups(list.map((f) => ({
            key: f.key,
            step: f.step,
            node: (
              <FindingCard
                f={f}
                ro={ro}
                pending={pending}
                clinicalDirty={clinicalDirty}
                details={details}
                diagnoses={diagnoses}
                requirements={requirements}
                onGo={onGo}
                onConfirm={(key, note) => fix(() => actions.confirmItem(caseId, { key, confirmed: true, note }))}
                onSaveClinical={saveClinical}
                onUpload={(docType, file) => {
                  const fd = new FormData();
                  fd.set("docType", docType);
                  fd.set("file", file);
                  return fix(() => actions.upload(caseId, fd));
                }}
              />
            ),
          })))
        )}
      </div>
    </div>
  );
}

/** One finding: why, what to do, and the quick fix that resolves it in place where one exists. */
function FindingCard({
  f,
  ro,
  pending,
  clinicalDirty,
  details,
  diagnoses,
  requirements,
  onGo,
  onConfirm,
  onSaveClinical,
  onUpload,
}: {
  f: Finding;
  ro: boolean;
  pending: boolean;
  clinicalDirty: boolean;
  details: PreauthDetailsInput;
  diagnoses: Coded[];
  requirements: WizardDocument[];
  onGo: (n: number) => void;
  onConfirm: (key: string, note?: string) => Promise<string | null>;
  onSaveClinical: (patch: QuickFixInput) => Promise<string | null>;
  onUpload: (docType: string, file: File) => Promise<string | null>;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [dx, setDx] = useState<string[]>(((details.diagnosisIds as string[] | undefined) ?? []).slice());
  const [when, setWhen] = useState<DateTimeValue>({});
  const [ills, setIlls] = useState<string[]>(((details.chronicIllness as string[] | undefined) ?? []).slice());

  const done = (r: string | null) => {
    setErr(r);
    if (!r) setOpen(false);
  };
  const field = f.key.startsWith("clinical:") ? f.key.slice("clinical:".length) : null;
  const docType = f.key.startsWith("document:") ? f.key.slice("document:".length) : null;
  const doc = docType ? requirements.find((r) => r.type === docType) : undefined;

  // Quick fixes for the clinical fields the checks report.
  const clinicalFix: Record<string, { label: string; form: () => ReactNode; patch: () => QuickFixInput | null }> = {
    diagnosisIds: {
      label: "Add Diagnosis",
      form: () => <ComboBox label="Diagnoses" multiple options={diagnoses.map((d) => ({ value: d.id, label: `${d.name} (${d.code})`, hint: d.code }))} value={dx} onChange={setDx} />,
      patch: () => (dx.length ? { diagnosisIds: dx } : null),
    },
    symptoms: {
      label: "Add Presenting Complaint",
      form: () => <TextAreaField label="Presenting Complaint" rows={2} value={text} onChange={(e) => setText(e.target.value)} />,
      patch: () => (text.trim() ? { symptoms: text } : null),
    },
    doctorName: {
      label: "Add Treating Doctor",
      form: () => <TextField label="Treating Doctor" value={text} onChange={(e) => setText(e.target.value)} />,
      patch: () => (text.trim() ? { doctorName: text } : null),
    },
    admissionDate: {
      label: "Set Stay Start",
      form: () => <DateTimePicker label="Stay starts — Date and time" required value={when} onChange={setWhen} />,
      patch: () => (when.date ? { admissionDate: when.date, admissionTime: when.time } : null),
    },
    dischargeDate: {
      label: "Set Stay End",
      form: () => <DateTimePicker label="Stay ends — Date and time" required value={when} onChange={setWhen} />,
      patch: () => (when.date ? { dischargeDate: when.date, dischargeTime: when.time } : null),
    },
    chronicIllness: {
      label: "Add Chronic Illness History",
      form: () => <ChronicIllnessInput value={ills} onChange={setIlls} />,
      patch: () => (ills.length ? { chronicIllness: ills } : null),
    },
    costItems: {
      label: "Enter Expected Cost",
      form: () => <TextField label="All-inclusive package (₹)" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} hint="Or itemize the heads in Clinical Details & Package." />,
      patch: () => (text.trim() ? { packageAmount: text } : null),
    },
  };
  const cf = field ? clinicalFix[field] : undefined;

  return (
    <div className={styles.finding} data-severity={f.severity} data-finding={f.key}>
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
        <div className={styles.quickFix}>
          {cf && !open && (
            <Button type="button" size="sm" disabled={pending || clinicalDirty} onClick={() => setOpen(true)}>{cf.label}</Button>
          )}
          {cf && open && (
            <form
              className={styles.quickForm}
              onSubmit={async (e) => {
                e.preventDefault();
                const p = cf.patch();
                if (!p) return setErr("Enter a value first.");
                done(await onSaveClinical(p));
              }}
            >
              {cf.form()}
              <div className={styles.quickActions}>
                <Button type="submit" size="sm" loading={pending}>Save</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          )}
          {doc && (
            <label htmlFor={inputId} className={styles.uploadButton} aria-disabled={pending || undefined}>
              Upload {doc.label.split(" (")[0]}
              <input
                id={inputId}
                type="file"
                accept={ACCEPT}
                disabled={pending}
                aria-label={`Upload: ${doc.label}`}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const bad = checkFiles([file]);
                  if (bad) return setErr(bad);
                  setErr(await onUpload(doc.type, file));
                }}
              />
            </label>
          )}
          {f.confirmItem && f.needsNote && (
            <>
              <TextField label="Verification note" placeholder="Who confirmed it with the payer, and how" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="button" size="sm" disabled={pending || note.trim().length < 10} onClick={async () => setErr(await onConfirm(f.confirmItem!, note))}>Record verification</Button>
            </>
          )}
          {f.confirmItem && !f.needsNote && (
            <Button type="button" size="sm" disabled={pending} onClick={async () => setErr(await onConfirm(f.confirmItem!))}>Confirm</Button>
          )}
          {!cf && !doc && !f.confirmItem && f.step !== 4 && (
            <Button type="button" size="sm" variant="secondary" onClick={() => onGo(f.step)}>Go to {WIZARD_STEPS[f.step - 1]}</Button>
          )}
        </div>
      )}
      {err && <Alert tone="danger">{err}</Alert>}
    </div>
  );
}
