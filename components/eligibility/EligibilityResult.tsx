import { formatINR } from "@/lib/india";
import { groupResults, OVERALL_LABEL } from "@/modules/eligibility/eligibility.sections";
import type { Evaluation, Outcome } from "@/modules/rules/engine/types";
import { Alert, Badge, Card, Stack, type Tone } from "@/components/ui/Surface";
import { Disclaimer } from "@/components/ui/Disclaimer";
import styles from "./EligibilityResult.module.css";

export const OUTCOME_TONE: Record<Outcome, Tone> = { PASS: "success", FAIL: "danger", NEEDS_VERIFICATION: "warning" };
export const OUTCOME_TEXT: Record<Outcome, string> = { PASS: "Passed", FAIL: "Failed", NEEDS_VERIFICATION: "Needs verification" };

/** Presentation of a rules-engine evaluation. Every line comes from a rule result. */
export function EligibilityResult({
  evaluation,
  policyName,
  ruleVersion,
  evaluationId,
  hospitalName,
}: {
  evaluation: Evaluation;
  policyName: string;
  ruleVersion: number | null;
  evaluationId: string | null;
  hospitalName?: string;
}) {
  const overall = OVERALL_LABEL[evaluation.overall];
  const sections = groupResults(evaluation.results);
  return (
    <Stack>
      <section className={`${styles.banner} ${styles[evaluation.overall]}`} aria-live="polite">
        <p className={styles.bannerLabel}>Eligibility result</p>
        <h2 className={styles.bannerTitle}>{overall.title}</h2>
        <p>{overall.detail}</p>
        <p className={styles.ref}>
          {policyName}
          {hospitalName ? ` · ${hospitalName}` : ""} · {ruleVersion ? `rules v${ruleVersion}` : "no published rules"}
          {evaluationId && <> · ref <span className="mono">{evaluationId.slice(0, 8)}</span></>}
        </p>
      </section>

      {evaluation.missingInformation.length > 0 && (
        <Alert tone="warning" title="Additional verification required">
          <ul className={styles.list}>
            {evaluation.missingInformation.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </Alert>
      )}

      <div className={styles.grid}>
        {sections.map((s) => (
          <Card key={s.key} title={s.label} actions={<Badge tone={OUTCOME_TONE[s.outcome]}>{OUTCOME_TEXT[s.outcome]}</Badge>}>
            <ul className={styles.results}>
              {s.results.map((r, i) => (
                <li key={`${r.code}-${i}`} className={r.applicable ? undefined : styles.na}>
                  <span className={styles.dot} data-outcome={r.outcome} aria-hidden="true" />
                  <span>
                    <strong>{r.title}</strong>
                    <span className={styles.msg}>{r.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {(evaluation.preauthRequired !== null || evaluation.estimate) && (
        <Card title="What this means for the admission">
          <Stack>
            {evaluation.preauthRequired !== null && (
              <p>
                Pre-authorization: <strong>{evaluation.preauthRequired ? "required before admission" : "not required"}</strong>
              </p>
            )}
            {evaluation.estimate && (
              <div>
                <p>
                  Indicative split of {formatINR(evaluation.estimate.estimatedCost)}: payer about <strong>{formatINR(evaluation.estimate.indicativePayerAmount)}</strong>, patient about{" "}
                  <strong>{formatINR(evaluation.estimate.indicativePatientAmount)}</strong>.
                </p>
                <ul className={styles.list}>
                  {evaluation.estimate.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
                <p className={styles.fine}>Indicative only. The final amount is decided by the payer and can differ from the estimate.</p>
              </div>
            )}
          </Stack>
        </Card>
      )}

      {evaluation.requiredDocuments.length > 0 && (
        <Card title="Documents that will be needed">
          <ul className={styles.docs}>
            {evaluation.requiredDocuments.map((d) => (
              <li key={`${d.stage}-${d.type}`}>
                {d.label} {d.mandatory ? <Badge tone="info">Mandatory</Badge> : <Badge tone="neutral">If applicable</Badge>}{" "}
                <span className={styles.fine}>{d.stage === "preauth" ? "pre-auth" : "final claim"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Disclaimer compact />
    </Stack>
  );
}
