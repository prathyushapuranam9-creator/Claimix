"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { ageOn, formatDate, formatDateTime, formatINR } from "@/lib/india";
import { useServerResult } from "@/lib/use-action-form";
import type { KycVerification, VerifyStatus } from "@/modules/preauth/kyc-verification";
import type { PolicyStatus } from "@/modules/preauth/preauth.service";
import { wizardKycSchema, type WizardKycInput } from "@/modules/preauth/preauth.validation";
import { aria, FieldShell } from "@/components/ui/Field";
import fieldStyles from "@/components/ui/Field.module.css";
import { formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";
import k from "./KycStep.module.css";

export const KYC_FORM_ID = "wizard-kyc";

export interface KycOptions {
  insurers: { id: string; name: string }[];
  tpasByInsurer: Record<string, { id: string; name: string }[]>;
}

export interface KycActions {
  raise: (input: { beneficiaryId?: string; kyc: WizardKycInput }) => Promise<ActionResult<string>>;
  saveKyc: (id: string, kyc: WizardKycInput) => Promise<ActionResult>;
  verify: (beneficiaryId: string, input: unknown) => Promise<ActionResult<KycVerification>>;
  policyStatus: (beneficiaryId: string, typed: { policyNumber?: string; memberId?: string }, caseId?: string) => Promise<ActionResult<PolicyStatus>>;
}

/** The patient as recorded by the hospital (the source of the KYC details and of Re-verify). */
export interface PatientOnRecord {
  patientNo: string;
  fullName: string;
  gender: string;
  dob: string;
  phone: string | null;
}

type Tone = "ok" | "warn" | "bad" | "muted";
const PATIENT_FIELDS = ["uhid", "aadhaar", "patientName", "gender", "dob", "mobile"] as const;
const VERIFY: Record<VerifyStatus, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "ok" },
  pending: { label: "Pending", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
};
const RESULT: Record<string, { label: string; tone: Tone }> = {
  match: { label: "Matches", tone: "ok" },
  mismatch: { label: "Differs", tone: "bad" },
  not_checked: { label: "Not checked", tone: "muted" },
};
const PRODUCT: Record<string, string> = { family_floater: "floater cover", individual: "individual cover", top_up: "top-up cover", group: "group cover" };
const productLabel = (t: string) => PRODUCT[t] ?? `${t.replace(/_/g, " ")} cover`;

const Svg = ({ d }: { d: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICON = {
  check: <Svg d={<path d="M20 6 9 17l-5-5" />} />,
  alert: <Svg d={<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>} />,
  x: <Svg d={<><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>} />,
  shield: <Svg d={<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>} />,
  refresh: <Svg d={<><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>} />,
  pencil: <Svg d={<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" /></>} />,
  info: <Svg d={<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>} />,
  percent: <Svg d={<><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>} />,
  bed: <Svg d={<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" />} />,
  layers: <Svg d={<><path d="m12 2 10 5-10 5L2 7Z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>} />,
  chevron: <Svg d={<path d="m6 9 6 6 6-6" />} />,
};
const clauseIcon = (kind: string) => (kind === "room_rent_limit" ? ICON.bed : kind === "co_pay" || kind === "deductible" ? ICON.percent : ICON.layers);
const toneIcon = (t: Tone) => (t === "ok" ? ICON.check : t === "bad" ? ICON.x : ICON.alert);

/**
 * Step 1: KYC & Policy as two cards side by side. 1A Patient KYC Verification: the KYC details (filled from the
 * patient's hospital record, read-only until Edit Demographics) and Re-verify via Aadhaar / UHID — a comparison with
 * that record. Claimix has no UIDAI, OTP or ABDM connection and says so rather than showing statuses it doesn't have.
 * 1B Policy Details & Coverage Identification, with the live policy balance and rules panel below it: real balances,
 * the policy's published clauses and eligibility results, and warnings that must be acknowledged to continue (cover
 * not in force blocks). Both checks are recomputed on the server when the step is saved.
 */
export function KycStep({
  caseId,
  defaults,
  beneficiaryId,
  matched,
  initialVerification,
  options,
  aadhaarOnFile,
  actions,
  disabled,
  onDone,
  onDirty,
}: {
  caseId?: string;
  defaults: Partial<WizardKycInput>;
  beneficiaryId: string;
  matched: string;
  /** The patient as recorded (kept for callers; the KYC fields are filled from it). */
  record?: PatientOnRecord;
  initialVerification?: KycVerification | null;
  options: KycOptions;
  /** The Aadhaar already known (on the case or the patient record), masked to its last 4 digits. */
  aadhaarOnFile?: string | null;
  actions: KycActions;
  disabled?: boolean;
  onDone: (id: string) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { register, handleSubmit, setError, setValue, control, formState, trigger, getValues } = useForm<WizardKycInput>({
    resolver: zodResolver(wizardKycSchema),
    defaultValues: { mode: "typed", ...defaults, policyWarningsAcknowledged: false },
  });
  const { formError, setFormError, apply } = useServerResult(setError);
  const e = formState.errors;
  const insurerId = useWatch({ control, name: "insurerId" });
  const [dob, livePolicyNumber, liveMemberId] = useWatch({ control, name: ["dob", "policyNumber", "memberId"] });
  const tpas = insurerId ? (options.tpasByInsurer[insurerId] ?? []) : [];

  // Demographics come from the record and stay read-only until Edit Demographics (or while something required is missing).
  const [editing, setEditing] = useState(() => !defaults.mobile || !defaults.gender || !defaults.patientName || !defaults.dob);
  const [verification, setVerification] = useState<KycVerification | null>(initialVerification ?? null);
  const [verifyMsg, setVerifyMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [policy, setPolicy] = useState<PolicyStatus | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  // The Live Policy Balance & Rules Engine panel starts collapsed each time this step is loaded.
  const [engineOpen, setEngineOpen] = useState(false);
  const [verifying, startVerify] = useTransition();
  const [loadingPolicy, startPolicy] = useTransition();
  const policySeq = useRef(0);

  // Live policy check: on opening the step and again (debounced) as the policy number / member ID are typed.
  useEffect(() => {
    const n = ++policySeq.current;
    const t = setTimeout(() => {
      startPolicy(async () => {
        const t0 = performance.now();
        const r = await actions.policyStatus(beneficiaryId, { policyNumber: String(livePolicyNumber ?? ""), memberId: String(liveMemberId ?? "") }, caseId);
        if (n !== policySeq.current) return; // a newer check is on its way
        // The measured round trip of this check (shown as the response time).
        setResponseMs(Math.round(performance.now() - t0));
        if (r.ok) {
          setPolicy(r.data);
          setPolicyError(null);
        } else setPolicyError(r.error);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [livePolicyNumber, liveMemberId, beneficiaryId, caseId, actions, retry]);

  const reverify = () =>
    startVerify(async () => {
      setVerifyMsg(null);
      if (!(await trigger([...PATIENT_FIELDS]))) {
        setEditing(true);
        return setVerifyMsg({ tone: "danger", text: "Correct the highlighted details first." });
      }
      const v = getValues();
      const r = await actions.verify(beneficiaryId, { uhid: v.uhid, aadhaar: v.aadhaar, patientName: v.patientName, gender: v.gender, dob: v.dob });
      if (!r.ok) return setVerifyMsg({ tone: "danger", text: r.error });
      setVerification(r.data);
      setVerifyMsg({ tone: r.data.status === "failed" ? "danger" : "success", text: `Re-verified against the patient record: ${VERIFY[r.data.status].label}.` });
    });

  const save = handleSubmit(
    async (kyc) => {
      setFormError(null);
      if (caseId) {
        if (apply(await actions.saveKyc(caseId, kyc))) {
          onDirty?.(false);
          onDone(caseId);
        }
        return;
      }
      const r = await actions.raise({ beneficiaryId, kyc });
      if (!apply(r)) return;
      onDirty?.(false);
      onDone(r.data);
    },
    (errs) => {
      // A problem in the demographics opens them for editing so it can be fixed.
      if (PATIENT_FIELDS.some((f) => errs[f])) setEditing(true);
    },
  );

  const warnings = policy?.warnings.filter((w) => w.severity === "warning") ?? [];
  const blockers = policy?.warnings.filter((w) => w.severity === "blocker") ?? [];
  const shown = policy?.validations.filter((v) => !v.atPreScrutiny) ?? [];
  const laterCount = (policy?.validations.length ?? 0) - shown.length;
  const engineState = !policy ? (loadingPolicy ? "Checking…" : policyError ? "Check failed" : "Not checked") : blockers.length ? "Not in force" : warnings.length ? "Review warnings" : "Policy intact";
  const engineTone: Tone = !policy ? (policyError ? "bad" : "muted") : blockers.length ? "bad" : warnings.length ? "warn" : "ok";
  const vs = verification ? VERIFY[verification.status] : null;
  const engineShown = engineOpen || !!e.policyWarningsAcknowledged?.message;
  const intactPct = policy && policy.available !== null && policy.sumInsured ? Math.round((policy.available / policy.sumInsured) * 100) : null;
  const barPct = intactPct === null ? 0 : Math.max(0, Math.min(100, intactPct));
  const balanceTone: Tone = !policy || policy.available === null ? "muted" : policy.available <= 0 ? "bad" : barPct < 50 ? "warn" : "ok";
  const heldTotal = policy?.holds.reduce((a, h) => a + h.amount, 0) ?? 0;
  // Each rule shown once. The "eligibility:" warnings are the same rules as the failing results, so they are not repeated.
  const passed = shown.filter((v) => v.outcome === "PASS");
  const failing = shown.filter((v) => v.outcome !== "PASS");
  const otherWarnings = warnings.filter((w) => !w.key.startsWith("eligibility:"));
  // A notice whose rule already has a result above (e.g. "Pre-authorization for cashless" passed) is not repeated.
  const notices = policy?.notices.filter((n) => !shown.some((v) => v.code === n.code)) ?? [];
  const issueCount = blockers.length + failing.length + otherWarnings.length + notices.length;
  const issuesTone: Tone = blockers.length || failing.some((v) => v.outcome === "FAIL") ? "bad" : "warn";
  const ro = !editing || !!disabled;
  const age = typeof dob === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? ageOn(dob) : null;
  const coverTag = policy ? (policy.coverStatus === "in_force" ? "In force" : policy.coverStatus === "expired" ? "Expired" : "Not started") : undefined;

  type Name = "uhid" | "aadhaar" | "patientName" | "dob" | "mobile" | "policyNumber" | "policyFrom" | "policyTo" | "memberId" | "sumInsured";
  const field = (
    name: Name,
    label: string,
    o: { required?: boolean; type?: string; readOnly?: boolean; inputMode?: "numeric" | "decimal" | "tel"; maxLength?: number; placeholder?: string; hint?: string; tag?: ReactNode; tone?: Tone; prefix?: string } = {},
  ) => {
    const id = `kyc-${name}`;
    const err = (e as Record<string, { message?: string } | undefined>)[name]?.message;
    return (
      <FieldShell id={id} label={label} required={o.required} error={err} hint={o.hint}>
        <div className={k.control} data-prefixed={o.prefix ? "true" : undefined}>
          {o.prefix && <span className={k.prefix} aria-hidden="true">{o.prefix}</span>}
          <input
            id={id}
            className={fieldStyles.control}
            type={o.type ?? "text"}
            inputMode={o.inputMode}
            maxLength={o.maxLength}
            placeholder={o.placeholder}
            readOnly={o.readOnly}
            aria-required={o.required || undefined}
            autoComplete="off"
            {...aria(id, err, o.hint)}
            {...register(name)}
          />
          {o.tag && <span className={k.tag} data-tone={o.tone ?? "muted"}>{o.tag}</span>}
        </div>
      </FieldShell>
    );
  };

  return (
    <form id={KYC_FORM_ID} className={formStyles.form} noValidate onSubmit={save} onChange={() => onDirty?.(true)} aria-busy={formState.isSubmitting || undefined}>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className={k.columns}>
        {/* 1A — Patient KYC Verification */}
        <section className={k.card} aria-labelledby="kyc-1a">
          <header className={k.cardHead}>
            <span className={k.stepTag}>1A</span>
            <h3 id="kyc-1a" className={k.cardTitle}>Patient KYC Verification</h3>
            <span className={k.pill} data-tone={vs?.tone ?? "warn"}>
              {toneIcon(vs?.tone ?? "warn")}
              <span data-testid="kyc-status">{vs ? vs.label : "Pending"}</span>
            </span>
          </header>
          <div className={k.cardBody}>
            <p className={k.matched} data-testid="matched-member">Patient on record: {matched}</p>
            <div className={k.grid}>
              {field("uhid", "UHID / IP Number", { readOnly: true, tag: "Hospital record", tone: "ok", hint: "From the hospital patient record." })}
              {field("aadhaar", "Aadhaar Number", {
                readOnly: ro,
                inputMode: "numeric",
                maxLength: 14,
                placeholder: aadhaarOnFile ?? "12 digits",
                tag: aadhaarOnFile ? "On record" : undefined,
                tone: "ok",
                hint: aadhaarOnFile ? "Masked — only the last 4 digits are shown. Enter the full number to check it." : "Optional. Only the last 4 digits are ever shown.",
              })}
              <div className={k.full}>{field("patientName", "Patient Name", { required: true, readOnly: ro })}</div>
              <FieldShell id="kyc-gender" label="Gender" required error={e.gender?.message}>
                <select
                  id="kyc-gender"
                  className={fieldStyles.control}
                  aria-required
                  aria-readonly={ro || undefined}
                  data-readonly={ro || undefined}
                  {...aria("kyc-gender", e.gender?.message)}
                  {...register("gender")}
                  // A select has no readOnly: while locked, opening and changing it is prevented (its value still submits).
                  onMouseDown={(ev) => ro && ev.preventDefault()}
                  onKeyDown={(ev) => ro && ev.key !== "Tab" && ev.preventDefault()}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </FieldShell>
              {field("dob", "Date of Birth", { required: true, type: "date", readOnly: ro, tag: age !== null ? `${age} yrs` : undefined })}
              <div className={k.full}>{field("mobile", "Mobile Number", { required: true, type: "tel", inputMode: "numeric", maxLength: 10, readOnly: ro, prefix: "+91" })}</div>
            </div>
            <p className={k.statusLine}>
              {ICON.info} Mobile not OTP-verified — no OTP service is configured in Claimix.
            </p>
            <div className={k.subtle}>
              <div className={k.subtleHead}>
                <strong>ABHA Address</strong>
                <span className={k.pill} data-tone="muted">Not linked</span>
              </div>
              <p className={k.muted}>Claimix has no ABDM connection, so no ABHA address or consent artefact is recorded for this patient.</p>
            </div>
            {verification && (
              <details className={k.details}>
                <summary>Verification details · checked {formatDateTime(verification.checkedAt)}</summary>
                <ul className={k.verifyList} aria-label="Verification results">
                  {verification.items.map((i) => (
                    <li key={i.field}>
                      <span className={k.pill} data-tone={RESULT[i.result]!.tone}>{RESULT[i.result]!.label}</span> <strong>{i.label}</strong> <span className={k.muted}>{i.note}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {verifyMsg && <Alert tone={verifyMsg.tone}>{verifyMsg.text}</Alert>}
            <p className={k.note}>
              Re-verify compares these details with the patient&apos;s hospital record in Claimix, found by UHID; Aadhaar is compared with the number on that record
              without being shown. Nothing is sent to UIDAI.
            </p>
          </div>
          {!disabled && (
            <footer className={k.cardFoot}>
              <button type="button" className={k.btn} onClick={reverify} disabled={verifying} aria-busy={verifying || undefined}>
                {ICON.refresh} {verifying ? "Re-verifying…" : "Re-verify via Aadhaar / UHID"}
              </button>
              <button type="button" className={k.linkBtn} aria-pressed={editing} onClick={() => setEditing((x) => !x)}>
                {ICON.pencil} {editing ? "Done editing" : "Edit Demographics"}
              </button>
            </footer>
          )}
        </section>

        <div className={k.stack}>
          {/* 1B — Policy Details & Coverage Identification */}
          <section className={k.card} aria-labelledby="kyc-1b">
            <header className={k.cardHead}>
              <span className={k.stepTag}>1B</span>
              <h3 id="kyc-1b" className={k.cardTitle}>Policy Details &amp; Coverage Identification</h3>
              {policy && (
                <span className={k.pill} data-tone={policy.coverStatus === "in_force" ? "ok" : "bad"}>
                  {policy.coverStatus === "in_force" ? `Active ${productLabel(policy.productType)}` : policy.coverStatus === "expired" ? "Cover expired" : "Cover not started"}
                </span>
              )}
            </header>
            <div className={k.cardBody}>
              <fieldset disabled={disabled} className={k.plain}>
                <div className={k.grid}>
                  <FieldShell id="kyc-insurer" label="Insurer" required error={e.insurerId?.message}>
                    <select id="kyc-insurer" className={fieldStyles.control} aria-required {...aria("kyc-insurer", e.insurerId?.message)} {...register("insurerId", { onChange: () => setValue("tpaId", "") })}>
                      <option value="">Select the insurer</option>
                      {options.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </FieldShell>
                  <FieldShell id="kyc-tpa" label="TPA (Third Party Administrator)" error={e.tpaId?.message}>
                    <select id="kyc-tpa" className={fieldStyles.control} disabled={!insurerId} {...aria("kyc-tpa", e.tpaId?.message)} {...register("tpaId")}>
                      {!insurerId ? <option value="">Choose the insurer first</option> : <option value="">{tpas.length ? "No TPA / select" : "No TPA on this insurer's policies"}</option>}
                      {tpas.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </FieldShell>
                  {field("policyNumber", "Policy Number", { required: true, tag: coverTag, tone: policy?.coverStatus === "in_force" ? "ok" : "bad" })}
                  {field("memberId", "TPA Card / Member ID", { tag: policy && policy.memberId === liveMemberId ? "Matches record" : undefined, tone: "ok" })}
                  {field("policyFrom", "Policy From", { required: true, type: "date" })}
                  {field("policyTo", "Policy To", { required: true, type: "date" })}
                  <div className={k.full}>{field("sumInsured", "Sum Insured (₹)", { inputMode: "decimal", hint: "As printed on the card or schedule." })}</div>
                </div>
              </fieldset>
            </div>
          </section>

          {/* Live Policy Balance & Rules Engine */}
          <section className={k.engine} aria-labelledby="kyc-engine" aria-busy={loadingPolicy || undefined}>
            <header className={k.engineHead}>
              {/* The whole heading is the toggle. The body stays rendered (only hidden), so collapsing keeps form values and the policy check. */}
              <h3 className={k.engineHeadTitle}>
                <button
                  type="button"
                  className={k.engineToggle}
                  aria-expanded={engineShown}
                  aria-controls="kyc-engine-body"
                  onClick={() => setEngineOpen(!engineShown)}
                >
                  <span className={k.engineIcon}>{ICON.shield}</span>
                  <span className={k.engineHeading}>
                    <span id="kyc-engine" className={k.engineTitle}>Live Policy Balance &amp; Rules Engine</span>
                    <span className={k.engineSub}>
                      Claimix rules engine{responseMs !== null ? ` · Response time: ${responseMs}ms` : ""}
                      {loadingPolicy ? " · updating…" : ""}
                    </span>
                  </span>
                  <span className={k.enginePill} data-tone={engineTone} data-testid="engine-status">● {engineState}</span>
                  <span className={k.chevron} aria-hidden="true">{ICON.chevron}</span>
                </button>
              </h3>
            </header>
            <div id="kyc-engine-body" className={k.engineBody} hidden={!engineShown}>
              {policyError && (
                <Alert tone="danger" title="The policy check couldn't run">
                  {policyError}{" "}
                  <button type="button" className={k.inlineLink} onClick={() => setRetry((r) => r + 1)}>Try again</button>
                </Alert>
              )}
              {!policy ? (
                <p className={k.muted}>{loadingPolicy ? "Checking the policy…" : "The policy check runs automatically."}</p>
              ) : (
                <>
                  {/* Balance summary: two equal cards; the bar is the share of the sum insured still available. */}
                  <div className={k.metrics} data-testid="available-balance">
                    <div className={k.metric}>
                      <span className={k.metricLabel}>{policy.productType === "family_floater" ? "Total floater sum insured" : "Total sum insured"}</span>
                      <strong className={k.metricValue} data-testid="sum-insured">{policy.sumInsured === null ? "Not recorded" : formatINR(policy.sumInsured)}</strong>
                      <span className={k.metricHint}>{policy.policyName}</span>
                    </div>
                    <div className={k.metric} data-tone={balanceTone}>
                      <span className={k.metricLabel}>
                        Available balance for claim
                        {intactPct !== null && <span className={k.pill} data-tone={balanceTone}>{intactPct}% {intactPct >= 100 ? "intact" : "left"}</span>}
                      </span>
                      <strong className={k.metricValue} data-testid="balance-available" data-tone={balanceTone}>{policy.available === null ? "Not recorded" : formatINR(policy.available)}</strong>
                      {intactPct !== null && (
                        <div
                          className={k.bar}
                          role="progressbar"
                          aria-label="Remaining coverage"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={barPct}
                          aria-valuetext={`${intactPct}% of the sum insured available`}
                          data-tone={balanceTone}
                        >
                          <span style={{ width: `${barPct}%` }} />
                        </div>
                      )}
                      {policy.recordedBalance !== null && policy.recordedBalance !== policy.sumInsured && (
                        <span className={k.metricHint}>Recorded balance {formatINR(policy.recordedBalance)} after settled claims</span>
                      )}
                    </div>
                  </div>

                  {/* Audit trail of the approvals held against this cover (collapsed). */}
                  {policy.holds.length ? (
                    <details className={k.audit}>
                      <summary>
                        <strong>{formatINR(heldTotal)}</strong> approved across {policy.holds.length} pre-auth{policy.holds.length === 1 ? "" : "s"} — <span className={k.auditLink}>View details</span>
                      </summary>
                      <ul className={k.auditList} aria-label="Approved pre-authorizations held against this cover">
                        {policy.holds.map((h) => (
                          <li key={h.reference}>
                            <span className="mono">{h.reference}</span>
                            <span>{formatINR(h.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <p className={k.auditNone}>{ICON.check} No other active approvals held against this cover</p>
                  )}

                  <h4 className={k.sectionTitle}>Coverage Clauses &amp; Sub-Limits</h4>
                  {policy.clauses.length === 0 ? (
                    <p className={k.muted}>This policy has no published limits or sub-limit clauses in Claimix.</p>
                  ) : (
                    <ul className={k.clauses} aria-label="Coverage clauses and sub-limits">
                      {policy.clauses.map((c) => {
                        // The sum insured clause's figure is the live available balance; the others come from the rule's own terms.
                        const value = c.kind === "sum_insured" ? (policy.available === null ? "Not recorded" : formatINR(policy.available)) : c.value;
                        return (
                          <li key={c.code} className={k.clause} title={c.text}>
                            <span className={k.clauseIcon}>{clauseIcon(c.kind)}</span>
                            <div>
                              <span className={k.clauseLabel}>{c.label}</span>
                              <strong className={k.clauseValue} data-tone={c.kind === "sum_insured" ? balanceTone : undefined}>{value ?? c.text}</strong>
                              {value && <span className={k.clauseText}>{c.text}</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Rules & checks: each rule once. Passed ones together; then failures, blockers, warnings and notices. */}
                  {passed.length > 0 && (
                    <div className={k.passed}>
                      <h4 className={k.groupTitle}>{ICON.check} {passed.length} check{passed.length === 1 ? "" : "s"} passed</h4>
                      <ul className={k.passedList} aria-label="Policy rule results: passed">
                        {passed.map((v) => (
                          <li key={v.code} className={k.passedItem}>
                            {ICON.check}
                            <span>
                              <strong>{v.title}</strong>
                              {v.message ? <span className={k.passedMsg}>{v.message}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {issueCount > 0 && (
                    <div className={k.issues} data-tone={issuesTone}>
                      <h4 className={k.groupTitle}>
                        {issuesTone === "bad" ? ICON.x : ICON.alert} {issueCount} item{issueCount === 1 ? "" : "s"} to review
                      </h4>
                      <ul className={k.checks} aria-label="Policy rule results: needs attention">
                        {blockers.map((b) => (
                          <li key={b.key} className={k.check} data-tone="bad">
                            {ICON.x}
                            <span>
                              <strong>{b.title}:</strong> {b.explanation}
                              <span className={k.action}>What to do: {b.action}</span>
                            </span>
                          </li>
                        ))}
                        {failing.map((v) => {
                          const t: Tone = v.outcome === "FAIL" ? "bad" : "warn";
                          // The corrective action comes from the matching policy warning (the same rule, shown once).
                          const action = warnings.find((w) => w.key === `eligibility:${v.code}`)?.action;
                          return (
                            <li key={v.code} className={k.check} data-tone={t}>
                              {toneIcon(t)}
                              <span>
                                <strong>{v.title}:</strong> {v.message}
                                {action && <span className={k.action}>What to do: {action}</span>}
                              </span>
                            </li>
                          );
                        })}
                        {otherWarnings.map((w) => (
                          <li key={w.key} className={k.check} data-tone="warn">
                            {ICON.alert}
                            <span>
                              <strong>{w.title}:</strong> {w.explanation}
                              <span className={k.action}>What to do: {w.action}</span>
                            </span>
                          </li>
                        ))}
                        {notices.map((n) => (
                          <li key={`n-${n.code}`} className={k.check} data-tone="warn">
                            {ICON.info}
                            <span><strong>{n.title}:</strong> {n.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {laterCount > 0 && (
                    <p className={k.note}>
                      {laterCount} rule{laterCount === 1 ? "" : "s"} that depend{laterCount === 1 ? "s" : ""} on the admission, diagnosis, treatment or cost {laterCount === 1 ? "is" : "are"} checked in
                      AI Pre-Scrutiny &amp; Rules Engine once those details are entered.
                    </p>
                  )}
                  {warnings.length > 0 && blockers.length === 0 && (
                    <label className={k.ack}>
                      <input type="checkbox" {...register("policyWarningsAcknowledged")} />
                      <span>I have reviewed these {warnings.length === 1 ? "warning" : `${warnings.length} warnings`} and continue; they are recorded with the claim.</span>
                    </label>
                  )}
                  {e.policyWarningsAcknowledged?.message && <span role="alert" className={k.error}>{e.policyWarningsAcknowledged.message}</span>}
                  <p className={k.engineFoot}>
                    <span>Coverage {formatDate(policy.coverStart)} – {formatDate(policy.coverEnd)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{policy.hospitalName}</span>
                  </p>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
      {formState.isSubmitting && <p className={k.muted} role="status">Saving…</p>}
    </form>
  );
}
