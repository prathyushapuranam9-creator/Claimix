"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, formatDateTime } from "@/lib/india";
import type { PatientEligibilityResult, PatientEligibilityStatus, CoverageStatus } from "@/modules/eligibility/patient-eligibility.service";
import { checkPatientEligibilityAction } from "@/app/(app)/patients/actions";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, type Tone } from "@/components/ui/Surface";
import styles from "./PatientEligibility.module.css";

export interface EligibilityCoverageOption {
  id: string;
  policyName: string;
  memberId: string;
}

/** What the panel shows for the selected policy. */
type Status = "idle" | "checking" | "error";

interface Ctx {
  coverage: EligibilityCoverageOption[];
  addCoverageHref: string | null;
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
  coverage,
  addCoverageHref,
  children,
}: {
  patientId: string;
  coverage: EligibilityCoverageOption[];
  addCoverageHref: string | null;
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
    coverage,
    addCoverageHref,
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
  const { coverage, addCoverageHref, open, selected, select, status, result, recheck } = useEligibility();
  const checking = status === "checking";

  return (
    <div id={PANEL_ID} className={styles.anchor} hidden={!open}>
      {open && (
        <Card
          title="Eligibility Result"
          actions={
            selected && (
              <Button type="button" size="sm" variant="secondary" loading={checking} onClick={recheck}>
                Check again
              </Button>
            )
          }
        >
          <div aria-live="polite" className={styles.body}>
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
            {result && <ResultDetails r={result} stale={checking} />}
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
