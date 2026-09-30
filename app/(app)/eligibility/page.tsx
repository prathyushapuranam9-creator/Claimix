import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { scopeFor } from "@/lib/permissions/principal";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { CoverageService } from "@/modules/patients/coverage.service";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { PolicyService } from "@/modules/policies/policies.service";
import { EligibilityForm } from "@/components/eligibility/EligibilityForm";
import { ButtonLink } from "@/components/ui/Button";
import { Details } from "@/components/ui/Form";
import { Card, PageHeader, Stack } from "@/components/ui/Surface";
import { checkEligibilityAction } from "./actions";

export const metadata: Metadata = { title: "Eligibility checker · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function EligibilityPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("eligibility:check");
  const sp = await searchParams;
  const beneficiary = param(sp, "beneficiary");
  const cov = beneficiary ? await orNotFound(CoverageService.get(ctx, beneficiary)) : null;
  const isAdmin = scopeFor(ctx.principal, "eligibility:check") === "all";
  const [policies, diagnoses, procedures, hospitals] = await Promise.all([
    PolicyService.options(ctx),
    ClinicalRepository.diagnosisOptions(ctx.db),
    ClinicalRepository.procedureOptions(ctx.db),
    isAdmin ? OrganizationRepository.options(ctx.db, ["hospital"]) : Promise.resolve(undefined),
  ]);

  return (
    <>
      <PageHeader
        title="Eligibility checker"
        description="Checks the case against the selected policy's own published rules. Missing information is flagged — never guessed."
        actions={cov && <ButtonLink href="/eligibility" variant="secondary">Check without a registered patient</ButtonLink>}
      />
      <Stack>
        {cov && (
          <Card title={`Checking ${cov.patient.fullName}`}>
            <Details
              columns={3}
              items={[
                [cov.category === "government" ? "Scheme cover" : "Policy", cov.policyName],
                ["Member ID", <span key="m" className="mono">{cov.memberId}</span>],
                ["Relationship", RELATIONSHIP_LABEL[cov.relationship as keyof typeof RELATIONSHIP_LABEL] ?? cov.relationship],
                ["Cover period", `${formatDate(cov.coverStart)} – ${formatDate(cov.coverEnd)}`],
                ["Sum insured", formatINR(cov.sumInsured)],
                ["Available balance", formatINR(cov.sumInsuredAvailable)],
              ]}
            />
          </Card>
        )}
        <EligibilityForm action={checkEligibilityAction} beneficiaryId={cov?.id} policies={policies} hospitals={hospitals} diagnoses={diagnoses} procedures={procedures} />
      </Stack>
    </>
  );
}
