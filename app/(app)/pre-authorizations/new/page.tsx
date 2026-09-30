import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { CoverageService } from "@/modules/patients/coverage.service";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import type { PreauthDetailsInput } from "@/modules/preauth/preauth.validation";
import { NewPreauthForm } from "@/components/preauth/NewPreauthForm";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable, FilterBar } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Alert, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { createPreauthAction } from "../actions";

export const metadata: Metadata = { title: "New pre-authorization · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const CARRY = ["claimType", "diagnosisId", "procedureId", "admissionDate", "isAccident", "pedDeclared", "pedRelated", "estimatedCost", "roomRentPerDay"] as const;

export default async function NewPreauthPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("preauth:create");
  if (ctx.principal.orgType !== "hospital" || ctx.principal.roleKey === "patient") redirect("/forbidden");
  const sp = await searchParams;
  const beneficiary = param(sp, "beneficiary");

  if (!beneficiary) {
    const q = param(sp, "q");
    const rows = await CoverageService.pickerForHospital(ctx, q);
    return (
      <>
        <PageHeader title="New pre-authorization" description="Step 1: choose the patient's recorded policy or scheme cover." />
        <Card padded={false}>
          <FilterBar basePath="/pre-authorizations/new" q={q} searchLabel="Patient name, number or member ID" />
          <DataTable
            caption="Patient coverage"
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No matching coverage">Register the patient and add their coverage first, then run an eligibility check.</EmptyState>}
            columns={[
              { key: "p", header: "Patient", cell: (r) => <CellText sub={r.patientNo}>{r.patientName}</CellText> },
              { key: "c", header: "Cover", cell: (r) => <CellText sub={<span className="mono">{r.memberId}</span>}>{r.policyName}</CellText> },
              { key: "e", header: "Valid until", nowrap: true, cell: (r) => formatDate(r.coverEnd) },
              { key: "a", header: "", cell: (r) => <ButtonLink size="sm" href={`/pre-authorizations/new?beneficiary=${r.id}`}>Select</ButtonLink> },
            ]}
          />
        </Card>
      </>
    );
  }

  const cov = await orNotFound(CoverageService.get(ctx, beneficiary));
  const [diagnoses, procedures] = await Promise.all([ClinicalRepository.diagnosisOptions(ctx.db), ClinicalRepository.procedureOptions(ctx.db)]);
  // Values carried over from the eligibility check (the server validates them again on save).
  const defaults = Object.fromEntries(CARRY.map((k) => [k, param(sp, k)]).filter(([, v]) => v !== undefined)) as Partial<PreauthDetailsInput>;

  return (
    <>
      <PageHeader title="New pre-authorization" description="Step 2: case details. You'll add documents and complete the checklist on the next screen." />
      <Stack>
        <Card title={cov.patient.fullName}>
          <Details
            columns={3}
            items={[
              [cov.category === "government" ? "Scheme cover" : "Policy", cov.policyName],
              ["Member ID", <span key="m" className="mono">{cov.memberId}</span>],
              ["Relationship", RELATIONSHIP_LABEL[cov.relationship as keyof typeof RELATIONSHIP_LABEL] ?? cov.relationship],
              ["Cover period", `${formatDate(cov.coverStart)} – ${formatDate(cov.coverEnd)}`],
              ["Available balance", formatINR(cov.sumInsuredAvailable)],
            ]}
          />
        </Card>
        <Alert tone="info">Pre-authorization approval is an initial estimate, not the final settlement. The final amount is decided on the final bill.</Alert>
        <Card>
          <NewPreauthForm beneficiaryId={cov.id} create={createPreauthAction} defaults={defaults} diagnoses={diagnoses} procedures={procedures} />
        </Card>
      </Stack>
    </>
  );
}
