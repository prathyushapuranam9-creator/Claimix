import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { todayIso } from "@/lib/validation";
import { nhcxStatus } from "@/modules/nhcx/nhcx";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { COVER_PERIOD_LABEL, coverPeriodStatus } from "@/modules/patients/coverage.validation";
import { PATIENT_DEPARTMENTS } from "@/modules/patients/patients.validation";
import type { MemberRow } from "@/modules/preauth/preauth.repository";
import { PreauthService } from "@/modules/preauth/preauth.service";
import type { WizardKycInput } from "@/modules/preauth/preauth.validation";
import { NewCaseStart } from "@/components/preauth/wizard/NewCaseStart";
import { NewClaimWizard, type WizardView } from "@/components/preauth/wizard/NewClaimWizard";
import { FullFormNote } from "@/components/preauth/wizard/WizardChrome";
import { WIZARD_STEPS } from "@/components/preauth/wizard/steps";
import styles from "@/components/preauth/wizard/NewClaimWizard.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable, FilterBar } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import {
  confirmWizardItemAction, raiseCaseAction, readCardAction, removeWizardDocumentAction, runAuditChecksAction, saveClinicalAction, saveKycAction, submitWizardAction,
  uploadWizardDocumentAction,
} from "./actions";

export const metadata: Metadata = { title: "New Claim · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const PATH = "/pre-authorizations/raise";
const TITLE = "New Claim";
const SUBTITLE = "A cashless pre-authorization: find the patient, then KYC and policy, clinical details and package, supporting documents, pre-scrutiny, and review";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** KYC & Policy filled from the patient and coverage on record (the reviewer only adds what Claimix doesn't hold). */
function kycFromMember(m: MemberRow): Partial<WizardKycInput> {
  const phone = m.phone?.replace(/\D/g, "").slice(-10);
  return {
    uhid: m.patientNo,
    patientName: m.fullName,
    // "undisclosed" on record: the reviewer picks it from the photo ID.
    ...(m.gender === "male" || m.gender === "female" || m.gender === "other" ? { gender: m.gender } : {}),
    dob: m.dob,
    ...(phone && phone.length === 10 ? { mobile: phone } : {}),
    ...(m.insurerId ? { insurerId: m.insurerId } : {}),
    tpaId: m.tpaId ?? "",
    memberId: m.memberId,
    policyFrom: m.coverStart,
    policyTo: m.coverEnd,
    ...(m.sumInsured !== null ? { sumInsured: m.sumInsured } : {}),
  };
}

const matchedText = (m: MemberRow) => `${m.fullName} · ${m.patientNo} · member ${m.memberId} · ${m.policyName} · ${m.hospitalName}`;

export default async function NewClaimPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("preauth:raise");
  // Insurer / TPA reviewers only: the service refuses everyone else too.
  if (ctx.principal.orgType !== "insurer" && ctx.principal.orgType !== "tpa") redirect("/forbidden");
  const sp = await searchParams;
  const id = param(sp, "id");
  // The full pre-authorization form (cases under way, reimbursements) belongs to the hospital desk, so reviewers get
  // the explanation rather than a link they can't open.
  const fullFormHref: string | null = null;
  const kycActions = { readCard: readCardAction, raise: raiseCaseAction, saveKyc: saveKycAction, upload: uploadWizardDocumentAction, remove: removeWizardDocumentAction };
  const header = <PageHeader title={TITLE} description={SUBTITLE} />;
  const today = todayIso();

  if (!id) {
    const memberId = param(sp, "member");
    // A patient was selected: open the claim form with their details filled in from the record.
    if (memberId) {
      const [m, options] = await Promise.all([orNotFound(PreauthService.member(ctx, memberId)), PreauthService.kycOptions(ctx)]);
      return (
        <div className={styles.page}>
          {header}
          <NewCaseStart defaults={kycFromMember(m)} beneficiaryId={m.beneficiaryId} matched={matchedText(m)} patientName={m.fullName} options={options} actions={kycActions} />
        </div>
      );
    }

    // First: find the patient (the reviewer's own members only).
    const q = param(sp, "q") ?? "";
    const [rows, drafts] = await Promise.all([PreauthService.members(ctx, q), PreauthService.raisedDrafts(ctx)]);
    return (
      <div className={styles.page}>
        {header}
        <Stack>
          <Card title="Find the patient" padded={false}>
            <FilterBar basePath={PATH} q={q} searchLabel="UHID / IP Number / Patient Name" submitLabel="Find" searchIcon />
            {q.trim().length < 2 ? (
              <EmptyState title="Search for the patient">Enter at least 2 characters of the UHID, IP / member number or the patient&apos;s name, then select Find.</EmptyState>
            ) : (
              <DataTable
                caption="Matching patients"
                rows={rows}
                rowKey={(r) => r.beneficiaryId}
                empty={<EmptyState title="No matching patient">Only members of your organization&apos;s own policies are listed.</EmptyState>}
                columns={[
                  { key: "p", header: "Patient", cell: (r) => <CellText sub={`UHID ${r.patientNo}`}>{r.fullName}</CellText> },
                  { key: "m", header: "Member ID", cell: (r) => <span className="mono">{r.memberId}</span> },
                  { key: "c", header: "Policy", cell: (r) => <CellText sub={r.hospitalName}>{r.policyName}</CellText> },
                  {
                    key: "s",
                    header: "Cover",
                    nowrap: true,
                    cell: (r) => {
                      const st = coverPeriodStatus(r, today);
                      return <Badge tone={st === "in_force" ? "success" : "danger"}>{COVER_PERIOD_LABEL[st]}</Badge>;
                    },
                  },
                  {
                    key: "a",
                    header: "",
                    nowrap: true,
                    // Cover not in force can't carry a cashless claim (the server refuses it too).
                    cell: (r) => (coverPeriodStatus(r, today) === "in_force" ? <ButtonLink size="sm" href={`${PATH}?member=${r.beneficiaryId}`}>Select</ButtonLink> : null),
                  },
                ]}
              />
            )}
          </Card>
          {drafts.length > 0 && (
            <Card title="Resume a claim" padded={false}>
              <DataTable
                caption="Claims you can resume"
                rows={drafts}
                rowKey={(r) => r.id}
                columns={[
                  { key: "r", header: "Case", cell: (r) => <span className="mono">{r.reference}</span> },
                  { key: "p", header: "Patient", cell: (r) => <CellText sub={r.patientNo}>{r.patientName}</CellText> },
                  { key: "u", header: "Last saved", nowrap: true, cell: (r) => formatDateTime(r.updatedAt) },
                  { key: "a", header: "", nowrap: true, cell: (r) => <ButtonLink size="sm" variant="secondary" href={`${PATH}?id=${r.id}`}>Resume</ButtonLink> },
                ]}
              />
            </Card>
          )}
          <FullFormNote href={fullFormHref} />
        </Stack>
      </div>
    );
  }

  const w = await orNotFound(PreauthService.wizard(ctx, id));
  const [options, diagnoses, procedures] = await Promise.all([PreauthService.kycOptions(ctx), ClinicalRepository.diagnosisOptions(ctx.db), ClinicalRepository.procedureOptions(ctx.db)]);
  const stepParam = Number(param(sp, "step"));
  const step = Number.isInteger(stepParam) && stepParam >= 1 && stepParam <= WIZARD_STEPS.length ? stepParam : 1;
  const d = w.details;
  const m = w.member;
  const docCount = w.requirements.reduce((a, r) => a + r.uploaded, 0);
  // KYC as saved; a case raised before KYC was captured starts from the record.
  const kyc: Partial<WizardKycInput> = w.kyc ?? (m ? kycFromMember(m) : { uhid: w.patient.patientNo, patientName: w.patient.fullName, dob: w.patient.dob, memberId: w.beneficiary.memberId });
  const nhcx = nhcxStatus();

  const view: WizardView = {
    id: w.preauth.id,
    reference: w.preauth.reference,
    status: w.preauth.status,
    editable: w.editable,
    patientName: w.kyc?.patientName ?? w.patient.fullName,
    mobile: w.kyc?.mobile ?? w.patient.phone ?? null,
    kyc,
    beneficiaryId: w.preauth.beneficiaryId,
    matched: m ? matchedText(m) : `${w.patient.fullName} · member ${w.beneficiary.memberId}`,
    kycOptions: options,
    details: d,
    diagnoses,
    procedures,
    departments: Object.values(PATIENT_DEPARTMENTS),
    files: w.documents.map((x) => ({ id: x.id, docType: x.docType, originalName: x.originalName, scanStatus: x.scanStatus, status: x.status })),
    requirements: w.requirements,
    policyHasDocumentRules: w.policyHasDocumentRules,
    scrutiny: w.scrutiny,
    evaluatedAt: w.evaluation ? w.evaluation.evaluatedAt.toISOString() : null,
    ruleVersion: w.evaluation?.ruleVersion ?? null,
    summary: [
      ["Patient", `${w.patient.fullName} (${w.patient.patientNo})`],
      ["Mobile", w.kyc?.mobile ?? "Not recorded"],
      ["Policy", `${w.policy.name}${w.kyc?.policyNumber ? ` · ${w.kyc.policyNumber}` : ""}`],
      ["Member ID", w.beneficiary.memberId],
      ["Insurer / TPA", [w.insurerName, w.tpaName].filter(Boolean).join(" · ") || "—"],
      ["Hospital", w.hospitalName ?? "—"],
      ["Diagnoses (ICD-10)", w.diagnoses.length ? w.diagnoses.map((x) => `${x.code} ${x.name}`).join("; ") : "Not entered"],
      ["Treatment / package", w.procedureName ?? "Not entered"],
      ["Line of treatment", d.treatmentType ? cap(String(d.treatmentType)) : "Not entered"],
      ["Admission", d.admissionType ? `${cap(String(d.admissionType))} · ${formatDate(w.preauth.expectedAdmission)}` : "Not entered"],
      ["Stay", w.preauth.expectedStayDays ? `${w.preauth.expectedStayDays} ${w.preauth.expectedStayDays === 1 ? "day" : "days"}` : "Not entered"],
      ["Treating doctor", d.doctorName ? `${d.doctorName}${d.doctorContact ? ` · ${d.doctorContact}` : ""}` : "Not entered"],
      ["Expected cost", formatINR(w.preauth.estimatedCost)],
      ["Available balance", formatINR(w.beneficiary.sumInsuredAvailable)],
      ["Supporting documents", String(docCount)],
    ],
    nhcx: { connected: nhcx.connected, text: nhcx.connected ? `Sent through NHCX (${nhcx.name}).` : nhcx.reason },
    fullFormHref,
  };

  return (
    <div className={styles.page}>
      {header}
      <NewClaimWizard
        key={w.preauth.id}
        view={view}
        initialStep={step}
        actions={{
          ...kycActions,
          saveClinical: saveClinicalAction,
          runChecks: runAuditChecksAction,
          confirmItem: confirmWizardItemAction,
          submit: submitWizardAction,
        }}
      />
    </div>
  );
}
