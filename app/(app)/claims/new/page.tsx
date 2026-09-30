import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { ClaimService } from "@/modules/claims/claims.service";
import type { ClaimDetailsInput } from "@/modules/claims/claims.validation";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { STATUS_LABEL, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { NewClaimForm } from "@/components/claims/NewClaimForm";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable, FilterBar } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { createCashlessClaimAction, createReimbursementClaimAction } from "../actions";

export const metadata: Metadata = { title: "New claim · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function NewClaimPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("claim:create");
  if (ctx.principal.orgType !== "hospital" || ctx.principal.roleKey === "patient") redirect("/forbidden");
  const sp = await searchParams;
  const preauthId = param(sp, "preauth");
  const beneficiaryId = param(sp, "beneficiary");

  if (!preauthId && !beneficiaryId) {
    const q = param(sp, "q");
    const [preauths, coverage] = await Promise.all([ClaimService.claimablePreauths(ctx), CoverageService.pickerForHospital(ctx, q)]);
    return (
      <>
        <PageHeader title="New claim" description="Cashless claims start from an approved pre-authorization. Reimbursement claims start from the patient's coverage." />
        <Stack>
          <Card title="Cashless: approved pre-authorizations" padded={false}>
            <DataTable
              caption="Approved pre-authorizations without a claim"
              rows={preauths}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No approved pre-authorizations waiting for a claim" />}
              columns={[
                { key: "r", header: "Pre-auth", cell: (r) => <CellText sub={r.patientName}><span className="mono">{r.reference}</span></CellText> },
                { key: "s", header: "Status", cell: (r) => <Badge tone="success">{STATUS_LABEL[r.status as PreauthStatus]}</Badge> },
                { key: "t", header: "Treatment", cell: (r) => <CellText sub={r.expectedAdmission ? `Admission ${formatDate(r.expectedAdmission)}` : undefined}>{r.procedureName ?? "—"}</CellText> },
                { key: "a", header: "Approved", align: "right", cell: (r) => formatINR(r.approvedAmount) },
                { key: "go", header: "", cell: (r) => <ButtonLink size="sm" href={`/claims/new?preauth=${r.id}`}>Start claim</ButtonLink> },
              ]}
            />
          </Card>
          <Card title="Reimbursement: choose the patient's coverage" padded={false}>
            <FilterBar basePath="/claims/new" q={q} searchLabel="Patient name, number or member ID" />
            <DataTable
              caption="Patient coverage"
              rows={coverage}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No matching coverage" />}
              columns={[
                { key: "p", header: "Patient", cell: (r) => <CellText sub={r.patientNo}>{r.patientName}</CellText> },
                { key: "c", header: "Cover", cell: (r) => <CellText sub={<span className="mono">{r.memberId}</span>}>{r.policyName}</CellText> },
                { key: "go", header: "", cell: (r) => <ButtonLink size="sm" variant="secondary" href={`/claims/new?beneficiary=${r.id}`}>Start reimbursement claim</ButtonLink> },
              ]}
            />
          </Card>
        </Stack>
      </>
    );
  }

  const [diagnoses, procedures] = await Promise.all([ClinicalRepository.diagnosisOptions(ctx.db), ClinicalRepository.procedureOptions(ctx.db)]);

  if (preauthId) {
    const w = await orNotFound(PreauthService.workspace(ctx, preauthId));
    const p = w.preauth;
    const clinical = p.clinical as Record<string, string | undefined>;
    // Pre-fill from the pre-auth; the final bill and dates are entered from the discharge papers.
    const defaults: Partial<ClaimDetailsInput> = {
      diagnosisId: p.diagnosisId ?? "",
      procedureId: p.procedureId ?? "",
      admissionDate: p.expectedAdmission ?? "",
      roomRentPerDay: p.roomRentPerDay ?? "",
      isAccident: (clinical.isAccident as ClaimDetailsInput["isAccident"]) ?? "unknown",
      pedDeclared: (clinical.pedDeclared as ClaimDetailsInput["pedDeclared"]) ?? "unknown",
      pedRelated: (clinical.pedRelated as ClaimDetailsInput["pedRelated"]) ?? "unknown",
    };
    return (
      <>
        <PageHeader title="New cashless claim" description={`From pre-authorization ${p.reference}`} />
        <Stack>
          <Card title={w.patient.fullName}>
            <Details columns={3} items={[["Policy", w.policy.name], ["Pre-auth status", STATUS_LABEL[p.status as PreauthStatus]], ["Approved amount", formatINR(p.approvedAmount)]]} />
          </Card>
          <Alert tone="info">The final claim is assessed on the final bill. The approved amount can be lower than the pre-authorized amount.</Alert>
          <Card>
            <NewClaimForm source={{ preAuthId: p.id }} createCashless={createCashlessClaimAction} createReimbursement={createReimbursementClaimAction} defaults={defaults} diagnoses={diagnoses} procedures={procedures} />
          </Card>
        </Stack>
      </>
    );
  }

  const cov = await orNotFound(CoverageService.get(ctx, beneficiaryId!));
  return (
    <>
      <PageHeader title="New reimbursement claim" description="For treatment the patient has already paid for." />
      <Stack>
        <Card title={cov.patient.fullName}>
          <Details columns={3} items={[["Policy", cov.policyName], ["Member ID", <span key="m" className="mono">{cov.memberId}</span>], ["Available balance", formatINR(cov.sumInsuredAvailable)]]} />
        </Card>
        <Card>
          <NewClaimForm source={{ beneficiaryId: cov.id }} createCashless={createCashlessClaimAction} createReimbursement={createReimbursementClaimAction} defaults={{}} diagnoses={diagnoses} procedures={procedures} />
        </Card>
      </Stack>
    </>
  );
}
