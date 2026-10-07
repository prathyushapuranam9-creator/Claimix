import { formatDate, formatINR } from "@/lib/india";
import { OVERALL_LABEL } from "@/modules/eligibility/eligibility.sections";
import { documentLabel } from "@/modules/documents/document-types";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import type { Evaluation } from "@/modules/rules/engine/types";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card } from "@/components/ui/Surface";
import { OUTCOME_TONE } from "@/components/eligibility/EligibilityResult";

interface Props {
  reference: string;
  patient: { fullName: string; patientNo: string; dob: string };
  hospitalName: string | null;
  payerName: string | null;
  payerLabel: string;
  tpaName: string | null;
  policyName: string;
  beneficiary: { memberId: string; relationship: string; coverStart: string; coverEnd: string; verificationStatus: string };
  treatment: { diagnosis: string | null; procedure: string | null; claimType: string; admission: string | null; stayDays: number | null; room: string | null };
  money: { estimatedCost: string | null; requested: string | null; patientContribution: string | null };
  evaluation: { evaluation: Evaluation; ruleVersion: number } | null;
  documents: { docType: string; status: string }[];
}

/**
 * What is about to be sent to the payer, on one screen, so staff can confirm the patient, cover,
 * treatment, amounts and documents before submitting. Read-only: it reports the stored request and
 * the last recorded rules check. Submission itself is still decided on the server, which re-runs the
 * rules and recomputes the checklist at that moment.
 */
export function SubmissionReview(p: Props) {
  const evidence = p.documents.filter((d) => d.status === "uploaded" || d.status === "verified");
  const rejected = p.documents.filter((d) => d.status === "rejected" || d.status === "requires_reupload");
  const required = p.evaluation?.evaluation.requiredDocuments.filter((d) => d.stage === "preauth" && d.mandatory) ?? [];
  const missing = required.filter((r) => !evidence.some((d) => d.docType === r.type));
  const overall = p.evaluation?.evaluation.overall;

  return (
    <Card title="Review before submitting">
      <Details
        columns={3}
        items={[
          ["Reference", <span key="r" className="mono">{p.reference}</span>],
          ["Patient", `${p.patient.fullName} (${p.patient.patientNo})`],
          ["Date of birth", formatDate(p.patient.dob)],
          [p.payerLabel, p.payerName],
          ["TPA", p.tpaName],
          ["Policy / scheme", p.policyName],
          ["Member ID", <span key="m" className="mono">{p.beneficiary.memberId}</span>],
          ["Relationship", RELATIONSHIP_LABEL[p.beneficiary.relationship as keyof typeof RELATIONSHIP_LABEL] ?? p.beneficiary.relationship],
          ["Cover period", `${formatDate(p.beneficiary.coverStart)} – ${formatDate(p.beneficiary.coverEnd)}`],
          [
            "Coverage verification",
            p.beneficiary.verificationStatus === "verified" ? <Badge key="v" tone="success">Verified</Badge> : <Badge key="v" tone="warning">Requires verification</Badge>,
          ],
          ["Eligibility", overall ? <Badge key="e" tone={OUTCOME_TONE[overall]}>{OVERALL_LABEL[overall].title}</Badge> : "Not checked yet"],
          ["Rules version", p.evaluation ? `v${p.evaluation.ruleVersion}` : null],
          ["Hospital", p.hospitalName],
          ["Claim type", p.treatment.claimType === "cashless" ? "Cashless" : "Reimbursement"],
          ["Diagnosis", p.treatment.diagnosis],
          ["Procedure", p.treatment.procedure],
          ["Expected admission", formatDate(p.treatment.admission)],
          ["Length of stay", p.treatment.stayDays ? `${p.treatment.stayDays} days` : null],
          ["Room", p.treatment.room],
          ["Estimated cost", formatINR(p.money.estimatedCost)],
          ["Requested from payer", formatINR(p.money.requested)],
          ["Patient's share", formatINR(p.money.patientContribution)],
          ["Documents attached", `${evidence.length} of ${Math.max(required.length, evidence.length)}`],
        ]}
      />
      {missing.length > 0 && (
        <Alert tone="warning" title="Mandatory documents still missing">
          {missing.map((m) => documentLabel(m.type)).join(", ")}.
        </Alert>
      )}
      {rejected.length > 0 && (
        <Alert tone="warning" title="Documents the payer asked to be replaced">
          {rejected.map((d) => documentLabel(d.docType)).join(", ")} — upload a new copy; rejected documents don&apos;t count as evidence.
        </Alert>
      )}
      {p.beneficiary.verificationStatus !== "verified" && (
        <Alert tone="info" title="Coverage not yet verified against the insurance document">
          The member ID and cover dates were entered without the insurance card or policy document. Check them against the document if you have it —
          a mismatch is a common reason for payer queries.
        </Alert>
      )}
    </Card>
  );
}
