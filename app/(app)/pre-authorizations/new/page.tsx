import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { todayIso } from "@/lib/validation";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { CoverageService } from "@/modules/patients/coverage.service";
import { COVER_PERIOD_LABEL, coverPeriodStatus, RELATIONSHIP_LABEL, VERIFICATION_LABEL } from "@/modules/patients/coverage.validation";
import type { PreauthDetailsInput } from "@/modules/preauth/preauth.validation";
import { NewPreauthForm } from "@/components/preauth/NewPreauthForm";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable, FilterBar } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { createPreauthAction } from "../actions";

export const metadata: Metadata = { title: "New pre-authorization · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const CARRY = ["claimType", "diagnosisId", "procedureId", "admissionDate", "isAccident", "pedDeclared", "pedRelated", "estimatedCost", "roomRentPerDay"] as const;

export default async function NewPreauthPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("preauth:create");
  if (ctx.principal.orgType !== "hospital" || ctx.principal.roleKey === "patient") redirect("/forbidden");
  const sp = await searchParams;
  const beneficiary = param(sp, "beneficiary");

  const today = todayIso();

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
              {
                key: "e",
                header: "Cover period",
                nowrap: true,
                cell: (r) => {
                  const st = coverPeriodStatus(r, today);
                  return (
                    <CellText sub={st === "in_force" ? (r.verificationStatus === "verified" ? undefined : VERIFICATION_LABEL.requires_verification) : <Badge tone={st === "expired" ? "danger" : "warning"}>{COVER_PERIOD_LABEL[st]}</Badge>}>
                      {formatDate(r.coverStart)} – {formatDate(r.coverEnd)}
                    </CellText>
                  );
                },
              },
              {
                key: "a",
                header: "",
                nowrap: true,
                // Cover that is not current can't carry a pre-authorization (the server refuses it too),
                // so the row leads to the patient instead, where the coverage can be fixed or replaced.
                cell: (r) =>
                  coverPeriodStatus(r, today) === "in_force" ? (
                    <ButtonLink size="sm" href={`/pre-authorizations/new?beneficiary=${r.id}`}>Select</ButtonLink>
                  ) : (
                    <ButtonLink size="sm" variant="secondary" href={`/patients/${r.patientId}`}>Review coverage</ButtonLink>
                  ),
              },
            ]}
          />
        </Card>
      </>
    );
  }

  const cov = await orNotFound(CoverageService.get(ctx, beneficiary));
  const period = coverPeriodStatus(cov, today);
  if (period !== "in_force") {
    return (
      <>
        <PageHeader title="New pre-authorization" description={`${cov.patient.fullName} · ${cov.policyName}`} />
        <Stack>
          <Alert tone="danger" title={period === "expired" ? "This cover has ended" : "This cover has not started yet"}>
            <p>
              Recorded cover period: {formatDate(cov.coverStart)} – {formatDate(cov.coverEnd)}. A pre-authorization asks the payer to cover an admission
              now, so it can only be raised on cover that is in force. Correct the recorded dates, or add the coverage the patient is insured under today.
            </p>
          </Alert>
          <Card title="What to do next">
            <p>
              <ButtonLink href={`/patients/${cov.patientId}/coverage/${cov.id}/edit`}>Review / edit coverage</ButtonLink>{" "}
              <ButtonLink href={`/patients/${cov.patientId}`} variant="secondary">Open patient</ButtonLink>{" "}
              <ButtonLink href="/pre-authorizations/new" variant="ghost">Choose another cover</ButtonLink>
            </p>
          </Card>
        </Stack>
      </>
    );
  }
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
              ["Policy number", cov.policyNumber ? <span key="pn" className="mono">{cov.policyNumber}</span> : null],
              ["Relationship", RELATIONSHIP_LABEL[cov.relationship as keyof typeof RELATIONSHIP_LABEL] ?? cov.relationship],
              ["Policyholder", cov.policyholderName],
              ["Cover period", `${formatDate(cov.coverStart)} – ${formatDate(cov.coverEnd)}`],
              ["Available balance", formatINR(cov.sumInsuredAvailable)],
              [
                "Verification",
                cov.verificationStatus === "verified" ? <Badge key="v" tone="success">Verified</Badge> : <Badge key="v" tone="warning">{VERIFICATION_LABEL.requires_verification}</Badge>,
              ],
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
