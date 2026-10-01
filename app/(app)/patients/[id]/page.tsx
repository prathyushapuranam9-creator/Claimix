import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { ageOn, formatDate, formatDateTime, formatINR } from "@/lib/india";
import { can } from "@/lib/permissions/principal";
import { todayIso } from "@/lib/validation";
import { CoverageService } from "@/modules/patients/coverage.service";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { PatientService } from "@/modules/patients/patients.service";
import { GENDER_LABEL } from "@/modules/patients/patients.validation";
import { PolicyService } from "@/modules/policies/policies.service";
import { CoverageForm } from "@/components/patients/CoverageForm";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { addCoverageAction } from "../actions";

export const metadata: Metadata = { title: "Patient · Claimix" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("patient:read");
  const { id } = await params;
  const { patient: p, hospitalName } = await orNotFound(PatientService.get(ctx, id));
  const canWrite = can(ctx.principal, "patient:write");
  const canCheck = can(ctx.principal, "eligibility:check");
  const [coverage, policyOptions] = await Promise.all([CoverageService.forPatient(ctx, p.id), canWrite ? PolicyService.options(ctx) : Promise.resolve([])]);
  // Contact details are shown to the registering hospital and the patient only.
  const showContact = ctx.principal.orgType === "hospital" || ctx.principal.orgType === "platform";
  const today = todayIso();

  return (
    <>
      <PageHeader
        title={p.fullName}
        description={<>Patient <span className="mono">{p.patientNo}</span> · {hospitalName}</>}
        actions={canWrite && <ButtonLink href={`/patients/${p.id}/edit`} variant="secondary">Edit details</ButtonLink>}
      />
      <Stack>
        <Card title="Details">
          <Details
            columns={3}
            items={[
              ["Date of birth", `${formatDate(p.dob)} (${ageOn(p.dob)} years)`],
              ["Gender", GENDER_LABEL[p.gender]],
              ["Registered", formatDateTime(p.createdAt)],
              ...(showContact
                ? ([
                    ["Mobile", p.phone],
                    ["Email", p.email],
                  ] as [string, string | null][])
                : []),
            ]}
          />
        </Card>
        <Card title="Insurance & scheme coverage" padded={false}>
          <DataTable
            caption="Coverage"
            rows={coverage}
            rowKey={(c) => c.id}
            empty={<EmptyState title="No coverage recorded">{canWrite ? "Add the patient's insurance policy or scheme enrolment to check eligibility." : undefined}</EmptyState>}
            columns={[
              { key: "p", header: "Policy / scheme", cell: (c) => <CellText sub={c.category === "government" ? c.schemeName : c.insurerName}>{c.policyName}</CellText> },
              { key: "m", header: "Member ID", cell: (c) => <CellText sub={RELATIONSHIP_LABEL[c.relationship as keyof typeof RELATIONSHIP_LABEL] ?? c.relationship}><span className="mono">{c.memberId}</span></CellText> },
              {
                key: "d",
                header: "Cover period",
                nowrap: true,
                cell: (c) => (
                  <CellText sub={c.coverEnd < today ? <Badge tone="danger">Expired</Badge> : c.coverStart > today ? <Badge tone="warning">Not started</Badge> : <Badge tone="success">In force</Badge>}>
                    {formatDate(c.coverStart)} – {formatDate(c.coverEnd)}
                  </CellText>
                ),
              },
              { key: "b", header: "Available", align: "right", cell: (c) => <CellText sub={`of ${formatINR(c.sumInsured)}`}>{formatINR(c.sumInsuredAvailable)}</CellText> },
              ...(canCheck ? [{ key: "a", header: "", cell: (c: (typeof coverage)[number]) => <ButtonLink size="sm" variant="secondary" href={`/eligibility?beneficiary=${c.id}`}>Check eligibility</ButtonLink> }] : []),
            ]}
          />
        </Card>
        {canWrite && (
          <Card title="Add coverage">
            <CoverageForm action={addCoverageAction.bind(null, p.id)} policies={policyOptions} />
          </Card>
        )}
      </Stack>
    </>
  );
}
