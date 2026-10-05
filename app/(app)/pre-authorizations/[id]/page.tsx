import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { workflowSteps } from "@/modules/eligibility/workflow";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { PreauthService } from "@/modules/preauth/preauth.service";
import type { PreauthDetailsInput } from "@/modules/preauth/preauth.validation";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { DocumentList } from "@/components/documents/DocumentList";
import { reviewDocumentAction } from "@/app/(app)/documents/actions";
import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { EligibilityResult } from "@/components/eligibility/EligibilityResult";
import { ChecklistPanel } from "@/components/preauth/ChecklistPanel";
import { DecisionPanel } from "@/components/preauth/DecisionPanel";
import { PreauthForm } from "@/components/preauth/PreauthForm";
import { SimpleMessageForm } from "@/components/preauth/SimpleMessageForm";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, PageHeader, Stack } from "@/components/ui/Surface";
import { Timeline } from "@/components/workflow/Timeline";
import { WorkflowStepper } from "@/components/workflow/WorkflowStepper";
import {
  cancelPreauthAction, confirmItemAction, decidePreauthAction, respondToQueryAction, runChecksAction, submitPreauthAction, updatePreauthAction, uploadDocumentAction,
} from "../actions";
import styles from "@/components/workflow/Workspace.module.css";

export const metadata: Metadata = { title: "Pre-authorization · Claimix" };

const TRI = { yes: "Yes", no: "No", unknown: "Not known" } as Record<string, string>;

export default async function PreauthPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("preauth:read");
  const { id } = await params;
  const w = await orNotFound(PreauthService.workspace(ctx, id));
  const p = w.preauth;
  const status = p.status as PreauthStatus;
  const clinical = p.clinical as Record<string, string | undefined>;
  const isHospitalView = ctx.principal.orgType === "hospital";
  const [diagnoses, procedures, reasons] = await Promise.all([
    w.can.edit ? ClinicalRepository.diagnosisOptions(ctx.db) : Promise.resolve([]),
    w.can.edit ? ClinicalRepository.procedureOptions(ctx.db) : Promise.resolve([]),
    w.can.decide.length ? PreauthService.reasons(ctx) : Promise.resolve([]),
  ]);
  const openQueries = w.queries.filter((q) => q.query.status === "open");
  const suggestedDocs = w.evaluation?.evaluation.requiredDocuments.filter((d) => d.stage === "preauth").map((d) => d.type) ?? [];

  const defaults: Partial<PreauthDetailsInput> = {
    claimType: p.claimType,
    diagnosisId: p.diagnosisId ?? "",
    procedureId: p.procedureId ?? "",
    admissionDate: p.expectedAdmission ?? "",
    isAccident: (clinical.isAccident as PreauthDetailsInput["isAccident"]) ?? "unknown",
    pedDeclared: (clinical.pedDeclared as PreauthDetailsInput["pedDeclared"]) ?? "unknown",
    pedRelated: (clinical.pedRelated as PreauthDetailsInput["pedRelated"]) ?? "unknown",
    estimatedCost: p.estimatedCost ?? "",
    roomRentPerDay: p.roomRentPerDay ?? "",
    expectedStayDays: p.expectedStayDays ?? "",
    roomCategory: p.roomCategory ?? "",
    expectedInsuranceAmount: p.expectedInsuranceAmount ?? "",
    patientContribution: p.patientContribution ?? "",
    symptoms: clinical.symptoms ?? "",
    clinicalFindings: clinical.clinicalFindings ?? "",
    medicalHistory: clinical.medicalHistory ?? "",
    investigationSummary: clinical.investigationSummary ?? "",
    proposedTreatment: clinical.proposedTreatment ?? "",
    doctorName: clinical.doctorName ?? "",
    doctorRegistrationNo: clinical.doctorRegistrationNo ?? "",
    employeeId: clinical.employeeId ?? "",
  };

  return (
    <>
      <PageHeader
        title={`Pre-auth ${p.reference}`}
        description={
          <>
            <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge> {w.patient.fullName} · {w.policy.name}
          </>
        }
      />
      <Stack>
        {w.claim ? (
          <Alert tone="info" title="Final claim">
            Claim <Link href={`/claims/${w.claim.id}`} className="mono">{w.claim.reference}</Link> is linked to this pre-authorization.
          </Alert>
        ) : (
          w.side === "hospital" && (status === "approved" || status === "partially_approved") && (
            <Alert tone="success" title="Approved — after discharge, raise the final claim">
              <ButtonLink href={`/claims/new?preauth=${p.id}`}>Start final claim</ButtonLink>
            </Alert>
          )
        )}
        <Card title="Progress">
          <WorkflowStepper steps={workflowSteps({ evaluation: w.evaluation?.evaluation, preauthStatus: status })} />
        </Card>

        {w.payersWithoutReviewer.length > 0 && (
          <Alert tone="warning" title="No reviewer can see this request yet">
            {w.payersWithoutReviewer.join(" and ")} {w.payersWithoutReviewer.length > 1 ? "have" : "has"} no reviewer account in Claimix, so nobody there can see or decide this pre-authorization.
            Ask your administrator to add a Payer Reviewer user for {w.payersWithoutReviewer.length > 1 ? "them" : "it"}; the request then appears in their dashboard automatically.
          </Alert>
        )}
        {openQueries.length > 0 && (
          <Alert tone="warning" title="Query from the payer">
            {openQueries.map((q) => (
              <div key={q.query.id} className={styles.query}>
                <p><strong>{q.reasonTitle}</strong> — {q.query.message}</p>
                {q.query.requiredDocuments.length > 0 && <p>Documents requested: {q.query.requiredDocuments.join(", ")}</p>}
                {q.reasonAction && <p>What to do: {q.reasonAction}</p>}
              </div>
            ))}
          </Alert>
        )}
        {p.submitOverrideReason && (
          <Alert tone="danger" title="Submitted despite failed checks">{p.submitOverrideReason}</Alert>
        )}

        <div className={styles.grid}>
          <div className={styles.main}>
            <Stack>
              <Card title="Patient & policy">
                <Details
                  columns={3}
                  items={[
                    ["Patient", `${w.patient.fullName} (${w.patient.patientNo})`],
                    ["Date of birth", formatDate(w.patient.dob)],
                    ["Relationship", RELATIONSHIP_LABEL[w.beneficiary.relationship as keyof typeof RELATIONSHIP_LABEL] ?? w.beneficiary.relationship],
                    [w.policy.category === "government" ? "Scheme" : "Insurer", w.policy.category === "government" ? w.schemeName : w.insurerName],
                    ["TPA", w.tpaName ?? "—"],
                    ["Member ID", <span key="m" className="mono">{w.beneficiary.memberId}</span>],
                    ["Cover period", `${formatDate(w.beneficiary.coverStart)} – ${formatDate(w.beneficiary.coverEnd)}`],
                    ["Hospital", w.hospitalName],
                    ["Claim type", p.claimType === "cashless" ? "Cashless" : "Reimbursement"],
                  ]}
                />
              </Card>

              {w.can.edit ? (
                <Card title="Case details">
                  <PreauthForm action={updatePreauthAction.bind(null, p.id)} defaults={defaults} diagnoses={diagnoses} procedures={procedures} submitLabel="Save changes" />
                </Card>
              ) : (
                <Card title="Medical & financial">
                  <Details
                    columns={3}
                    items={[
                      ["Diagnosis", w.diagnosisCode ? `${w.diagnosisCode} — ${w.diagnosisName}` : null],
                      ["Procedure", w.procedureName],
                      ["Expected admission", formatDate(p.expectedAdmission)],
                      ["Length of stay", p.expectedStayDays ? `${p.expectedStayDays} days` : null],
                      ["Room", [p.roomCategory, p.roomRentPerDay ? `${formatINR(p.roomRentPerDay)}/day` : null].filter(Boolean).join(" · ") || null],
                      ["Accident", TRI[clinical.isAccident ?? "unknown"]],
                      ["PED declared / related", `${TRI[clinical.pedDeclared ?? "unknown"]} / ${TRI[clinical.pedRelated ?? "unknown"]}`],
                      ["Estimated cost", formatINR(p.estimatedCost)],
                      ["Requested from payer", formatINR(p.expectedInsuranceAmount)],
                      ["Approved amount", formatINR(p.approvedAmount)],
                      ["Treating doctor", clinical.doctorName ?? null],
                      ["Submitted", formatDateTime(p.submittedAt)],
                    ]}
                  />
                  {(clinical.symptoms || clinical.clinicalFindings || clinical.proposedTreatment) && (
                    <div className={styles.notes}>
                      {clinical.symptoms && <p><strong>Symptoms:</strong> {clinical.symptoms}</p>}
                      {clinical.clinicalFindings && <p><strong>Findings:</strong> {clinical.clinicalFindings}</p>}
                      {clinical.medicalHistory && <p><strong>History:</strong> {clinical.medicalHistory}</p>}
                      {clinical.investigationSummary && <p><strong>Investigations:</strong> {clinical.investigationSummary}</p>}
                      {clinical.proposedTreatment && <p><strong>Proposed treatment:</strong> {clinical.proposedTreatment}</p>}
                    </div>
                  )}
                </Card>
              )}

              <Card title="Documents" padded={false}>
                {isHospitalView && w.side === "hospital" && !["rejected", "cancelled", "settled", "final_approved"].includes(status) && (
                  <div className={styles.pad}>
                    <DocumentUploader upload={uploadDocumentAction.bind(null, p.id)} suggested={suggestedDocs} />
                  </div>
                )}
                <DocumentList docs={w.documents} review={w.side === "payer" ? reviewDocumentAction : undefined} />
              </Card>

              {w.side === "hospital" && status === "draft" && (
                <Card title="Pre-authorization checklist">
                  <ChecklistPanel
                    checklist={w.checklist}
                    editable
                    checked={!!w.evaluation}
                    confirm={confirmItemAction.bind(null, p.id)}
                    runChecks={runChecksAction.bind(null, p.id)}
                    submit={submitPreauthAction.bind(null, p.id)}
                  />
                </Card>
              )}

              {w.evaluation && (
                <details className={styles.details} open={status === "draft"}>
                  <summary>Rule check results (rules v{w.evaluation.ruleVersion}, {formatDateTime(w.evaluation.evaluatedAt)})</summary>
                  <EligibilityResult evaluation={w.evaluation.evaluation} policyName={w.policy.name} ruleVersion={w.evaluation.ruleVersion} evaluationId={p.latestEvaluationId} />
                </details>
              )}
            </Stack>
          </div>

          <aside className={styles.side}>
            <Stack>
              {w.can.decide.length > 0 && (
                <Card title={w.can.recordsSchemeDecision ? "Record scheme decision" : "Decision"}>
                  <DecisionPanel
                    action={decidePreauthAction.bind(null, p.id)}
                    options={w.can.decide}
                    reasons={reasons.map((r) => ({ id: r.id, title: r.title, kind: r.kind }))}
                    requested={p.expectedInsuranceAmount ?? p.estimatedCost}
                    schemeDesk={w.can.recordsSchemeDecision}
                  />
                </Card>
              )}
              {w.can.respond && (
                <Card title="Respond to query">
                  <SimpleMessageForm action={respondToQueryAction.bind(null, p.id)} label="Response to the payer" hint="Upload any requested documents first, then describe what you've provided." button="Send response" />
                </Card>
              )}
              {can(ctx.principal, "assistant:use") && (
                <Card title="Questions about this request?">
                  <ButtonLink href={`/assistant?preauth=${p.id}`} variant="secondary">Ask the Insurance Assistant</ButtonLink>
                </Card>
              )}
              <Card title="Timeline">
                <Timeline entries={w.history} label={(s) => STATUS_LABEL[s as PreauthStatus] ?? s} tone={(s) => STATUS_TONE[s as PreauthStatus] ?? "neutral"} />
              </Card>
              {w.can.cancel && (
                <Card title="Cancel request">
                  <SimpleMessageForm action={cancelPreauthAction.bind(null, p.id)} label="Reason for cancelling" button="Cancel pre-authorization" tone="danger" />
                </Card>
              )}
            </Stack>
          </aside>
        </div>
      </Stack>
    </>
  );
}
