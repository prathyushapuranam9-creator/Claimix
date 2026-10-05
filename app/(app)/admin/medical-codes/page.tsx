import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { ClinicalService } from "@/modules/clinical/clinical.service";
import { CodeForm } from "@/components/reference/CodeForm";
import { DataTable } from "@/components/ui/DataTable";
import { Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { addDiagnosisAction, addProcedureAction } from "./actions";

export const metadata: Metadata = { title: "Medical codes · Claimix" };

export default async function MedicalCodesPage() {
  // Administrators only (the sidebar entry uses the same permission); the server actions check it again.
  const ctx = await pageContext("policy:manage");
  const { diagnoses, procedures } = await ClinicalService.lists(ctx);
  const canManage = can(ctx.principal, "policy:manage", "all");
  return (
    <>
      <PageHeader title="Medical codes" description="Diagnosis (ICD-10) and procedure codes offered in eligibility checks, pre-authorizations, claims and policy rules." />
      <Stack>
        <Card title={`Diagnoses (${diagnoses.length})`}>
          <Stack>
            {canManage && <CodeForm kind="diagnosis" action={addDiagnosisAction} />}
            <DataTable
              caption="Diagnosis codes"
              rows={diagnoses}
              rowKey={(d) => d.id}
              empty={<EmptyState title="No diagnosis codes yet">Add the ICD-10 codes your hospitals use.</EmptyState>}
              columns={[
                { key: "c", header: "Code", nowrap: true, cell: (d) => <span className="mono">{d.code}</span> },
                { key: "n", header: "Name", cell: (d) => d.name },
              ]}
            />
          </Stack>
        </Card>
        <Card title={`Procedures (${procedures.length})`}>
          <Stack>
            {canManage && <CodeForm kind="procedure" action={addProcedureAction} />}
            <DataTable
              caption="Procedure codes"
              rows={procedures}
              rowKey={(p) => p.id}
              empty={<EmptyState title="No procedure codes yet">Add the procedures your hospitals perform.</EmptyState>}
              columns={[
                { key: "c", header: "Code", nowrap: true, cell: (p) => <span className="mono">{p.code}</span> },
                { key: "n", header: "Name", cell: (p) => p.name },
              ]}
            />
          </Stack>
        </Card>
      </Stack>
    </>
  );
}
