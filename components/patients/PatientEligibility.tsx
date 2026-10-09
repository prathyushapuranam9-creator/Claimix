"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, formatDateTime } from "@/lib/india";
import type { PatientEligibilityResult, PatientEligibilityStatus, CoverageStatus } from "@/modules/eligibility/patient-eligibility.service";
import { checkPatientEligibilityAction } from "@/app/(app)/patients/actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, type Tone } from "@/components/ui/Surface";
import styles from "./PatientEligibility.module.css";

export interface EligibilityCoverageOption {
  id: string;
  policyName: string;
  memberId: string;
}

/**
 * What this user may do once a result is in. The hrefs are built per coverage, so the next step always
 * carries the patient and the policy that was actually checked. The server decides again on every
 * action; these only decide what is offered.
 */
export interface EligibilityNextSteps {
  preauth: boolean;
  claim: boolean;
  /** `/patients/<id>/coverage` — the coverage id and `/edit` are appended. */
  coverageEditBase: string | null;
  uploadDocumentHref: string | null;
}

/** What the panel shows for the selected policy. */
type Status = "idle" | "checking" | "error";

/** The patient as shown in Patient Details (already labelled, with empty values filled in by the page). */
export interface EligibilityPatientInfo {
  name: string;
  department: string;
  visitReason: string;
}

interface Ctx {
  patient: EligibilityPatientInfo;
  close: () => void;
  coverage: EligibilityCoverageOption[];
  addCoverageHref: string | null;
  next: EligibilityNextSteps;
  open: boolean;
  toggle: () => void;
  selected: string | null;
  select: (beneficiaryId: string) => void;
  status: Status;
  result: PatientEligibilityResult | null;
  recheck: () => void;
}

const EligibilityContext = createContext<Ctx | null>(null);

function useEligibility() {
  const c = useContext(EligibilityContext);
  if (!c) throw new Error("Eligibility components must be inside EligibilityCheckProvider.");
  return c;
}

const PANEL_ID = "eligibility-result";
const ERROR = "Unable to verify eligibility. Please try again.";

/**
 * Shares one patient's eligibility panel between the header toggle and the result card.
 * Render it with key={patientId}: opening another patient starts collapsed with no result,
 * and a late response for the previous patient is dropped.
 */
export function EligibilityCheckProvider({
  patientId,
  patient,
  coverage,
  addCoverageHref,
  next,
  children,
}: {
  patientId: string;
  patient: EligibilityPatientInfo;
  coverage: EligibilityCoverageOption[];
  addCoverageHref: string | null;
  next: EligibilityNextSteps;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(coverage[0]?.id ?? null);
  // Results of checks already run on this page, per policy — reopening shows them without a new request.
  const [results, setResults] = useState<Record<string, PatientEligibilityResult>>({});
  const [status, setStatus] = useState<Status>("idle");
  const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = (beneficiaryId: string) => {
    if (inFlight.current) return; // no duplicate requests
    inFlight.current = true;
    setStatus("checking");
    checkPatientEligibilityAction(patientId, beneficiaryId)
      .then((r) => {
        if (!live.current) return;
        if (r.ok && r.data.patientId === patientId && r.data.beneficiaryId === beneficiaryId) {
          setResults((m) => ({ ...m, [beneficiaryId]: r.data }));
          setStatus("idle");
        } else {
          // A failed check never leaves an older result looking current.
          setResults((m) => {
            const { [beneficiaryId]: _drop, ...rest } = m;
            return rest;
          });
          setStatus("error");
        }
      })
      .catch(() => {
        if (live.current) setStatus("error");
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Opening checks the selected policy unless a result (or a check) is already there.
    // With no insurance on record nothing is sent; the panel says so.
    if (next && selected && !results[selected] && !inFlight.current) run(selected);
  };

  const select = (beneficiaryId: string) => {
    if (inFlight.current) return;
    setSelected(beneficiaryId);
    setStatus("idle");
    if (!results[beneficiaryId]) run(beneficiaryId);
  };

  const ctx: Ctx = {
    patient,
    close: () => setOpen(false),
    coverage,
    addCoverageHref,
    next,
    open,
    toggle,
    selected,
    select,
    status,
    result: selected ? (results[selected] ?? null) : null,
    recheck: () => selected && run(selected),
  };
  return <EligibilityContext.Provider value={ctx}>{children}</EligibilityContext.Provider>;
}

/** "Eligibility Check ▾ / ▴" in the profile header: shows or hides the Eligibility Result panel. */
export function EligibilityCheckButton() {
  const { open, toggle } = useEligibility();
  return (
    <Button type="button" variant="secondary" aria-expanded={open} aria-controls={PANEL_ID} onClick={toggle}>
      Eligibility Check
      <span aria-hidden="true" className={styles.caret}>{open ? "▴" : "▾"}</span>
    </Button>
  );
}

const STATUS: Record<PatientEligibilityStatus, { label: string; tone: Tone }> = {
  eligible: { label: "Eligible", tone: "success" },
  not_eligible: { label: "Not Eligible", tone: "danger" },
  expired: { label: "Expired", tone: "danger" },
  unable_to_verify: { label: "Unable to Verify", tone: "warning" },
};

const COVERAGE: Record<CoverageStatus, { label: string; tone: Tone }> = {
  in_force: { label: "In force", tone: "success" },
  expired: { label: "Expired", tone: "danger" },
  not_started: { label: "Not started", tone: "warning" },
};

/** The collapsible "Eligibility Result" panel; hidden until the header toggle opens it. */
export function EligibilityResultCard() {
  const { patient, close, coverage, addCoverageHref, next, open, selected, select, status, result, recheck } = useEligibility();
  const checking = status === "checking";

  return (
    <div id={PANEL_ID} className={styles.anchor} hidden={!open}>
      {open && (
        <Card
          title="Eligibility Result"
          actions={
            <div className={styles.headActions}>
              {selected && (
                <Button type="button" size="sm" variant="secondary" loading={checking} onClick={recheck}>
                  Check again
                </Button>
              )}
              <button type="button" className={styles.close} aria-label="Close eligibility result" title="Close" aria-controls={PANEL_ID} onClick={close}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          }
        >
          <div aria-live="polite" className={styles.body}>
            {/* The same values as Patient Details and Policy Check for this patient. */}
            <div data-testid="eligibility-patient">
              <Details
                columns={3}
                items={[
                  ["Name", patient.name],
                  ["Department", patient.department],
                  ["Reason for Join", patient.visitReason],
                ]}
              />
            </div>
            {coverage.length > 1 && (
              <div className={styles.picker}>
                <SelectField label="Policy" value={selected ?? ""} disabled={checking} onChange={(e) => select(e.target.value)}>
                  {coverage.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.policyName} · {c.memberId}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
            {!selected && (
              <EmptyState title="No insurance information available for this patient.">
                {addCoverageHref ? <a href={addCoverageHref}>Add coverage</a> : undefined}
              </EmptyState>
            )}
            {checking && (
              <p className={styles.checking} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                Checking eligibility...
              </p>
            )}
            {status === "error" && <Alert tone="danger">{ERROR}</Alert>}
            {selected && !checking && status !== "error" && !result && <EmptyState title="No eligibility information available for this patient." />}
            {result && (
              <>
                <ResultDetails r={result} stale={checking} />
                <NextSteps r={result} next={next} />
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function ResultDetails({ r, stale }: { r: PatientEligibilityResult; stale: boolean }) {
  const status = STATUS[r.status];
  const cover = COVERAGE[r.coverageStatus];
  return (
    <div className={stale ? styles.stale : undefined} data-testid="eligibility-details">
      <Details
        columns={3}
        items={[
          ["Patient", <>{r.patientName} <span className="mono">({r.patientNo})</span></>],
          ["Insurance", r.insurance],
          ["Policy", r.policyName],
          ["Member ID", <span key="m" className="mono">{r.memberId}</span>],
          ["Coverage Status", <Badge key="c" tone={cover.tone}>{cover.label}</Badge>],
          ["Eligibility Status", <Badge key="s" tone={status.tone}>{status.label}</Badge>],
          ["Effective Date", formatDate(r.coverStart)],
          ["Expiry Date", formatDate(r.coverEnd)],
          ["Checked At", <time key="t" dateTime={r.checkedAt}>{formatDateTime(r.checkedAt)}</time>],
        ]}
      />
      {(r.reasons.length > 0 || r.missingInformation.length > 0) && (
        <div className={styles.notes}>
          {r.reasons.length > 0 && (
            <>
              <p className={styles.notesTitle}>Why</p>
              <ul>{r.reasons.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}</ul>
            </>
          )}
          {r.missingInformation.length > 0 && (
            <>
              <p className={styles.notesTitle}>Information still needed</p>
              <ul>{r.missingInformation.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}</ul>
            </>
          )}
        </div>
      )}
      <p className={styles.basis}>
        Checked against the recorded coverage for a cashless admission today. This is a rules check, not a payer decision or a guarantee of approval.
      </p>
    </div>
  );
}

/**
 * The step after a result, and only the step the result allows: a request can be started when the
 * cover is in force and no rule failed, otherwise the actions lead back to fixing or replacing the
 * coverage. The pre-auth and claim links carry the coverage that was checked, so the request is
 * raised against that policy and payer.
 */
function NextSteps({ r, next }: { r: PatientEligibilityResult; next: EligibilityNextSteps }) {
  const editHref = next.coverageEditBase ? `${next.coverageEditBase}/${r.beneficiaryId}/edit` : null;
  if (r.canStartRequest) {
    // The policy's rules decide which treatment workflow leads: a planned cashless admission that needs
    // pre-authorization, or a claim where the rules don't require one.
    const preauthFirst = r.preauthRequired !== false;
    const preauth = next.preauth && (
      <ButtonLink key="pa" size="sm" variant={preauthFirst ? "primary" : "secondary"} href={`/pre-authorizations/new?beneficiary=${r.beneficiaryId}`}>
        New Pre-Authorization
      </ButtonLink>
    );
    const claim = next.claim && (
      <ButtonLink key="cl" size="sm" variant={preauthFirst ? "secondary" : "primary"} href={`/claims/new?beneficiary=${r.beneficiaryId}`}>
        New Claim
      </ButtonLink>
    );
    return (
      <div className={styles.next}>
        <p className={styles.notesTitle}>Coverage is active. Next step:</p>
        {r.preauthRequired === true && <p>This policy requires a pre-authorization before admission.</p>}
        {r.preauthRequired === false && <p>This policy&apos;s rules don&apos;t require a pre-authorization for this case.</p>}
        <div className={styles.actions}>
          {preauthFirst ? [preauth, claim] : [claim, preauth]}
          {!next.preauth && !next.claim && <span>Pre-authorizations and claims are raised by the treating hospital&apos;s staff.</span>}
        </div>
      </div>
    );
  }
  const why =
    r.coverageStatus === "expired"
      ? "This cover has ended, so a pre-authorization or claim can't be raised on it."
      : r.coverageStatus === "not_started"
        ? "This cover has not started yet, so a pre-authorization or claim can't be raised on it."
        : r.outcome === "FAIL"
          ? "A policy rule failed for this case, so it can't be treated as covered."
          : "The cover could not be confirmed from the recorded details, so it can't be treated as active.";
  return (
    <div className={styles.next}>
      <p className={styles.notesTitle}>Not ready for a request</p>
      <p>{why} Check the recorded coverage against the patient&apos;s document, or record the cover they are insured under today.</p>
      <div className={styles.actions}>
        {editHref && <ButtonLink size="sm" variant="secondary" href={editHref}>Review / edit coverage</ButtonLink>}
        {next.uploadDocumentHref && <ButtonLink size="sm" variant="secondary" href={next.uploadDocumentHref}>Upload insurance document</ButtonLink>}
        {next.coverageEditBase && <ButtonLink size="sm" variant="ghost" href="#add-coverage">Add another coverage</ButtonLink>}
      </div>
    </div>
  );
}
