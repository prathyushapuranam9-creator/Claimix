"use client";

import { useState } from "react";
import { formatDateTime, formatINR } from "@/lib/india";
import { OVERALL_LABEL } from "@/modules/eligibility/eligibility.sections";
import type { EligibilityHistoryItem } from "@/modules/eligibility/eligibility.service";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Surface";
import { EligibilityResult, OUTCOME_TONE } from "./EligibilityResult";
import styles from "./EligibilityHistory.module.css";

function caseSummary(c: EligibilityHistoryItem["case"]) {
  return [
    c.claimType && (c.claimType === "cashless" ? "Cashless" : "Reimbursement"),
    c.admissionDate && `Admission ${c.admissionDate}`,
    c.diagnosisCode && `Dx ${c.diagnosisCode}`,
    c.procedureCode && `Procedure ${c.procedureCode}`,
    c.estimatedCost !== undefined && `Estimate ${formatINR(c.estimatedCost)}`,
  ].filter(Boolean) as string[];
}

/**
 * Previously recorded eligibility checks for a coverage, newest first. The latest one is open when the page
 * loads (so it is still there after a refresh); once a new check has been run in this session the live result
 * is shown above instead, and everything here stays collapsed. Details are rendered only when opened.
 */
export function EligibilityHistory({ items, liveId }: { items: EligibilityHistoryItem[]; liveId: string | null }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, index: number) => toggled[id] ?? (liveId === null && index === 0);

  return (
    <section id="previous-checks" aria-label="Previous eligibility checks">
      <Card title={`Previous eligibility checks${items.length ? ` (${items.length})` : ""}`}>
        {items.length === 0 ? (
          <p className={styles.empty}>No eligibility check has been recorded for this coverage yet.</p>
        ) : (
          <ol className={styles.list}>
            {items.map((it, i) => {
              const open = isOpen(it.id, i);
              const details = caseSummary(it.case);
              return (
                <li key={it.id} className={styles.item}>
                  <div className={styles.head}>
                    <Badge tone={OUTCOME_TONE[it.overall]}>{OVERALL_LABEL[it.overall].title}</Badge>
                    <span className={styles.when}>{formatDateTime(it.evaluatedAt)}</span>
                    {it.id === liveId && <Badge tone="info">Just checked</Badge>}
                    {i === 0 && it.id !== liveId && <span className={styles.latest}>Latest</span>}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-expanded={open}
                      aria-controls={`check-${it.id}`}
                      onClick={() => setToggled((t) => ({ ...t, [it.id]: !open }))}
                    >
                      {open ? "Hide details" : "View details"}
                    </Button>
                  </div>
                  <p className={styles.meta}>
                    {it.policyName} · {it.hospitalName} · rules v{it.ruleVersion} · ref <span className="mono">{it.id.slice(0, 8)}</span>
                    {it.checkedBy ? ` · checked by ${it.checkedBy}` : ""}
                  </p>
                  {details.length > 0 && <p className={styles.meta}>{details.join(" · ")}</p>}
                  {open && (
                    <div id={`check-${it.id}`} className={styles.detail}>
                      <EligibilityResult evaluation={it.evaluation} policyName={it.policyName} ruleVersion={it.ruleVersion} evaluationId={it.id} hospitalName={it.hospitalName} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </section>
  );
}
