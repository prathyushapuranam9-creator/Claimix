import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { ageOn, formatDate } from "@/lib/india";
import { parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { PatientService } from "@/modules/patients/patients.service";
import { departmentLabel, GENDER_LABEL } from "@/modules/patients/patients.validation";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { Card, EmptyState, PageHeader } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Patients · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PatientsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("patient:read");
  const q = parseListQuery(await searchParams);
  const data = await PatientService.list(ctx, q);
  const canWrite = can(ctx.principal, "patient:write");
  const multiHospital = ctx.principal.orgType !== "hospital";

  return (
    <>
      <PageHeader
        title="Patients"
        description={ctx.principal.orgType === "hospital" ? "Patients registered at your hospital." : "Patients linked to requests you can access."}
        actions={canWrite && <ButtonLink href="/patients/new">Register patient</ButtonLink>}
      />
      <Card padded={false}>
        <FilterBar basePath="/patients" q={q.q} searchLabel="Search by name or patient number" />
        <DataTable
          caption="Patients"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title={q.q ? "No patients match your search" : "No patients yet"}>{canWrite && !q.q ? "Register a patient to start an eligibility check." : undefined}</EmptyState>}
          columns={[
            { key: "name", header: "Patient", cell: (r) => <CellLink href={`/patients/${r.id}`} sub={<span className="mono">{r.patientNo}</span>}>{r.fullName}</CellLink> },
            { key: "age", header: "Age / Gender", nowrap: true, cell: (r) => `${ageOn(r.dob)} y · ${r.gender === "undisclosed" ? "—" : GENDER_LABEL[r.gender]}` },
            { key: "department", header: "Department", cell: (r) => departmentLabel(r.department) },
            ...(multiHospital ? [{ key: "hospital", header: "Hospital", cell: (r: (typeof data.rows)[number]) => r.hospitalName }] : []),
            { key: "registered", header: "Registered", nowrap: true, cell: (r) => formatDate(r.createdAt) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/patients" params={{ q: q.q }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
