import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { todayIso } from "@/lib/validation";
import { ClaimService } from "@/modules/claims/claims.service";
import type { ClaimDetailsInput } from "@/modules/claims/claims.validation";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { STATUS_LABEL as PREAUTH_LABEL, STATUS_TONE as PREAUTH_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { ClaimForm } from "@/components/claims/ClaimForm";
import { RejectionReasonCard } from "@/components/claims/RejectionReasonCard";
import { SettlementForm } from "@/components/claims/SettlementForm";
import { DocumentList } from "@/components/documents/DocumentList";
import { deleteDocumentAction, reviewDocumentAction } from "@/app/(app)/documents/actions";
import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { EligibilityResult } from "@/components/eligibility/EligibilityResult";
import { ChecklistPanel } from "@/components/preauth/ChecklistPanel";
import { SubmissionReview } from "@/components/preauth/SubmissionReview";
import { DecisionPanel } from "@/components/preauth/DecisionPanel";
import { SimpleMessageForm } from "@/components/preauth/SimpleMessageForm";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { ButtonLink } from "@/components/ui/Button";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, PageHeader, Stack, Stat } from "@/components/ui/Surface";
import { Timeline } from "@/components/workflow/Timeline";
import {
  cancelClaimAction, confirmClaimItemAction, decideClaimAction, respondClaimQueryAction, runClaimChecksAction, settleClaimAction, submitClaimAction, updateClaimAction, uploadClaimDocumentAction,
} from "../actions";
import styles from "@/components/workflow/Workspace.module.css";
import local from "./claim.module.css";

export const metadata: Metadata = { title: "Claim · Claimix" };

const DECISION_LABEL: Record<string, string> = { approved: "Approved", partially_approved: "Partially approved", rejected: "Rejected", query: "Query", pending: "Pending" };
const DECISION_TONE = { approved: "success", partially_approved: "success", rejected: "danger", query: "warning", pending: "info" } as const;
const TRI: Record<string, string> = { yes: "Yes", no: "No", unknown: "Not known" };

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("claim:read");
  const { id } = await params;
  const w = await orNotFound(ClaimService.workspace(ctx, id));
  const c = w.claim;
  const status = c.status as ClaimStatus;
  const clinical = c.clinical as Record<string, string | undefined>;
  const [diagnoses, procedures, reasons] = await Promise.all([
    w.can.edit ? ClinicalRepository.diagnosisOptions(ctx.db) : Promise.resolve([]),
    w.can.edit ? ClinicalRepository.procedureOptions(ctx.db) : Promise.resolve([]),
    w.can.decide.length ? PreauthService.reasons(ctx) : Promise.resolve([]),
  ]);
  const openQueries = w.queries.filter((q) => q.query.status === "open");
  const reasonResponses = w.payerResponses.filter((r) => r.reasonTitle);
  const suggestedDocs = w.evaluation?.evaluation.requiredDocuments.filter((d) => d.stage === "claim").map((d) => d.type) ?? ["final_bill", "discharge_summary"];

  const defaults: Partial<ClaimDetailsInput> = {
    diagnosisId: c.diagnosisId ?? "",
    procedureId: c.procedureId ?? "",
    admissionDate: c.admissionDate ?? "",
    dischargeDate: c.dischargeDate ?? "",
    billNumber: c.billNumber ?? "",
    claimedAmount: c.claimedAmount ?? "",
    roomRentPerDay: c.roomRentPerDay ?? "",
    isAccident: (clinical.isAccident as ClaimDetailsInput["isAccident"]) ?? "unknown",
    pedDeclared: (clinical.pedDeclared as ClaimDetailsInput["pedDeclared"]) ?? "unknown",
    pedRelated: (clinical.pedRelated as ClaimDetailsInput["pedRelated"]) ?? "unknown",
    finalDiagnosisNotes: clinical.finalDiagnosisNotes ?? "",
    treatmentGiven: clinical.treatmentGiven ?? "",
    nonPayableNotes: clinical.nonPayableNotes ?? "",
  };

  return (
    <>
      <PageHeader
        title={`Claim ${c.reference}`}
        description={<><Badge tone={CLAIM_STATUS_TONE[status]}>{CLAIM_STATUS_LABEL[status]}</Badge> {c.claimType === "cashless" ? "Cashless" : "Reimbursement"} · {w.patient.fullName}</>}
      />
      <Stack>
        {/* Claim summary */}
        <div className={local.stats}>
          <Stat label="Claimed" value={formatINR(c.claimedAmount)} />
          <Stat label="Approved" value={formatINR(c.approvedAmount)} />
          <Stat label="Patient pays" value={formatINR(c.patientAmount)} />
          <Stat label="Settled" value={w.settlement ? formatINR(w.settlement.amount) : "—"} />
        </div>

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
        {c.submitOverrideReason && <Alert tone="danger" title="Submitted despite failed checks">{c.submitOverrideReason}</Alert>}

        <div className={styles.grid}>
          <div className={styles.main}>
            <Stack>
              <Card title="Patient, policy & hospital">
                <Details
                  columns={3}
                  items={[
                    ["Patient", `${w.patient.fullName} (${w.patient.patientNo})`],
                    ["Date of birth", formatDate(w.patient.dob)],
                    ["Relationship", RELATIONSHIP_LABEL[w.beneficiary.relationship as keyof typeof RELATIONSHIP_LABEL] ?? w.beneficiary.relationship],
                    ["Policy", w.policy.name],
                    [w.policy.category === "government" ? "Scheme" : "Insurer", w.policy.category === "government" ? w.schemeName : w.insurerName],
                    ["TPA", w.tpaName ?? "—"],
                    ["Member ID", <span key="m" className="mono">{w.beneficiary.memberId}</span>],
                    ["Available balance", formatINR(w.beneficiary.sumInsuredAvailable)],
                    ["Hospital", w.hospitalName],
                  ]}
                />
              </Card>

              {w.can.edit ? (
                <Card title="Final bill & treatment">
                  <ClaimForm action={updateClaimAction.bind(null, c.id)} defaults={defaults} diagnoses={diagnoses} procedures={procedures} submitLabel="Save changes" />
                </Card>
              ) : (
                <Card title="Treatment & financial details">
                  <Details
                    columns={3}
                    items={[
                      ["Final diagnosis", w.diagnosisCode ? `${w.diagnosisCode} — ${w.diagnosisName}` : null],
                      ["Procedure", w.procedureName],
                      ["Admission / discharge", `${formatDate(c.admissionDate)} – ${formatDate(c.dischargeDate)}`],
                      ["Final bill no.", c.billNumber],
                      ["Room rent / day", formatINR(c.roomRentPerDay)],
                      ["Accident / PED", `${TRI[clinical.isAccident ?? "unknown"]} / ${TRI[clinical.pedDeclared ?? "unknown"]}`],
                      ["Claimed", formatINR(c.claimedAmount)],
                      ["Approved", formatINR(c.approvedAmount)],
                      ["Patient pays", formatINR(c.patientAmount)],
                    ]}
                  />
                  {(clinical.finalDiagnosisNotes || clinical.treatmentGiven || clinical.nonPayableNotes) && (
                    <div className={styles.notes}>
                      {clinical.finalDiagnosisNotes && <p><strong>Final diagnosis:</strong> {clinical.finalDiagnosisNotes}</p>}
                      {clinical.treatmentGiven && <p><strong>Treatment given:</strong> {clinical.treatmentGiven}</p>}
                      {clinical.nonPayableNotes && <p><strong>Non-payable items:</strong> {clinical.nonPayableNotes}</p>}
                    </div>
                  )}
                </Card>
              )}

              {w.preauth && (
                <Card title="Pre-authorization">
                  <Details
                    columns={3}
                    items={[
                      ["Reference", <Link key="r" href={`/pre-authorizations/${w.preauth.id}`} className="mono">{w.preauth.reference}</Link>],
                      ["Status", <Badge key="s" tone={PREAUTH_TONE[w.preauth.status as PreauthStatus]}>{PREAUTH_LABEL[w.preauth.status as PreauthStatus]}</Badge>],
                      ["Pre-authorized", formatINR(w.preauth.approvedAmount)],
                    ]}
                  />
                </Card>
              )}

              <Card title="Documents" padded={false}>
                {w.side === "hospital" && ["draft", "submitted", "pending", "query"].includes(status) && (
                  <div className={styles.pad}>
                    <DocumentUploader upload={uploadClaimDocumentAction.bind(null, c.id)} suggested={suggestedDocs} />
                  </div>
                )}
                <DocumentList docs={w.documents} review={w.side === "payer" ? reviewDocumentAction : undefined} remove={w.side === "hospital" && ["draft", "query"].includes(status) ? deleteDocumentAction : undefined} />
                {w.preauthDocuments.length > 0 && (
                  <details className={local.sub}>
                    <summary>Documents from the pre-authorization ({w.preauthDocuments.length})</summary>
                    <DocumentList docs={w.preauthDocuments} review={w.side === "payer" ? reviewDocumentAction : undefined} />
                  </details>
                )}
              </Card>

              {w.side === "hospital" && status === "draft" && (
                <SubmissionReview
                  stage="claim"
                  reference={c.reference}
                  patient={{ fullName: w.patient.fullName, patientNo: w.patient.patientNo, dob: w.patient.dob }}
                  hospitalName={w.hospitalName}
                  payerLabel={w.policy.category === "government" ? "Scheme" : "Insurance company"}
                  payerName={w.policy.category === "government" ? w.schemeName : w.insurerName}
                  tpaName={w.tpaName}
                  policyName={w.policy.name}
                  beneficiary={w.beneficiary}
                  caseRows={[
                    ["Claim type", c.claimType === "cashless" ? "Cashless" : "Reimbursement"],
                    ["Pre-authorization", w.preauth ? <span key="pa" className="mono">{w.preauth.reference}</span> : "None (reimbursement)"],
                    ["Final diagnosis", w.diagnosisCode ? `${w.diagnosisCode} — ${w.diagnosisName}` : null],
                    ["Procedure", w.procedureName],
                    ["Admission", formatDate(c.admissionDate)],
                    ["Discharge", formatDate(c.dischargeDate)],
                    ["Final bill no.", c.billNumber],
                    ["Room rent / day", formatINR(c.roomRentPerDay)],
                    ["Claimed amount", formatINR(c.claimedAmount)],
                  ]}
                  evaluation={w.evaluation ? { evaluation: w.evaluation.evaluation, ruleVersion: w.evaluation.ruleVersion } : null}
                  documents={w.documents.map((d) => ({ docType: d.docType, status: d.status }))}
                />
              )}

              {w.side === "hospital" && status === "draft" && (
                <Card title="Claim readiness checklist">
                  <ChecklistPanel
                    checklist={w.checklist}
                    editable
                    checked={!!w.evaluation}
                    confirm={confirmClaimItemAction.bind(null, c.id)}
                    runChecks={runClaimChecksAction.bind(null, c.id)}
                    submit={submitClaimAction.bind(null, c.id)}
                    submitLabel="Submit claim"
                  />
                </Card>
              )}

              {w.evaluation && (
                <details className={styles.details} open={status === "draft"}>
                  <summary>Rule check results (rules v{w.evaluation.ruleVersion}, {formatDateTime(w.evaluation.evaluatedAt)})</summary>
                  <EligibilityResult evaluation={w.evaluation.evaluation} policyName={w.policy.name} ruleVersion={w.evaluation.ruleVersion} evaluationId={c.latestEvaluationId} />
                </details>
              )}

              {reasonResponses.length > 0 && (
                <Card title="Query & rejection reasons">
                  <Stack>
                    {reasonResponses.map((r) => (
                      <RejectionReasonCard
                        key={r.id}
                        title={`${DECISION_LABEL[r.decision] ?? r.decision}: ${r.reasonTitle}`}
                        meaning={r.reasonMeaning}
                        whatToCheck={r.reasonCheck}
                        requiredAction={r.reasonAction}
                        remarks={r.remarks}
                      />
                    ))}
                  </Stack>
                </Card>
              )}

              <Card title="Approval history" padded={false}>
                <DataTable
                  caption="Payer responses"
                  rows={w.payerResponses}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "d", header: "Decision", cell: (r) => <Badge tone={DECISION_TONE[r.decision]}>{DECISION_LABEL[r.decision] ?? r.decision}</Badge> },
                    { key: "a", header: "Amount", align: "right", cell: (r) => formatINR(r.approvedAmount) },
                    { key: "r", header: "Reason / remarks", cell: (r) => <CellText sub={r.remarks}>{r.reasonTitle ?? "—"}</CellText> },
                    { key: "by", header: "Recorded", nowrap: true, cell: (r) => <CellText sub={r.recordedByName}>{formatDateTime(r.createdAt)}</CellText> },
                    { key: "ref", header: "Payer ref.", cell: (r) => r.payerReference ?? "—" },
                  ]}
                />
              </Card>

              {w.settlement && (
                <Card title="Settlement">
                  <Details
                    columns={3}
                    items={[
                      ["Amount paid", formatINR(w.settlement.amount)],
                      ["Paid to", w.settlement.payee === "hospital" ? "Hospital" : "Patient"],
                      ["Payment date", formatDate(w.settlement.settledAt)],
                      ["UTR / reference", <span key="u" className="mono">{w.settlement.utr}</span>],
                      ["Deductions", w.settlement.deductionNote],
                    ]}
                  />
                </Card>
              )}
              <Disclaimer compact />
            </Stack>
          </div>

          <aside className={styles.side}>
            <Stack>
              {w.can.decide.length > 0 && (
                <Card title={w.can.recordsSchemeDecision ? "Record scheme decision" : "Assessment"}>
                  <DecisionPanel
                    mode="claim"
                    action={decideClaimAction.bind(null, c.id)}
                    options={w.can.decide}
                    reasons={reasons.map((r) => ({ id: r.id, title: r.title, kind: r.kind }))}
                    requested={c.claimedAmount}
                    schemeDesk={w.can.recordsSchemeDecision}
                  />
                </Card>
              )}
              {w.can.settle && (
                <Card title="Record settlement">
                  <SettlementForm action={settleClaimAction.bind(null, c.id)} approved={c.approvedAmount} payee={c.claimType === "cashless" ? "hospital" : "patient"} today={todayIso()} />
                </Card>
              )}
              {w.can.respond && (
                <Card title="Respond to query">
                  <SimpleMessageForm action={respondClaimQueryAction.bind(null, c.id)} label="Response to the payer" hint="Upload any requested documents first, then describe what you've provided." button="Send response" />
                </Card>
              )}
              {can(ctx.principal, "assistant:use") && (
                <Card title="Questions about this claim?">
                  <ButtonLink href={`/assistant?claim=${c.id}`} variant="secondary">Ask the Insurance Assistant</ButtonLink>
                </Card>
              )}
              <Card title="Activity timeline">
                <Timeline entries={w.history} label={(s) => CLAIM_STATUS_LABEL[s as ClaimStatus] ?? s} tone={(s) => CLAIM_STATUS_TONE[s as ClaimStatus] ?? "neutral"} />
              </Card>
              {w.can.cancel && (
                <Card title="Cancel claim">
                  <SimpleMessageForm action={cancelClaimAction.bind(null, c.id)} label="Reason for cancelling" button="Cancel claim" tone="danger" />
                </Card>
              )}
            </Stack>
          </aside>
        </div>
      </Stack>
    </>
  );
}
