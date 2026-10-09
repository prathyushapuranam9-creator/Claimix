import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/auth/context";
import { ageOn, formatDate } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { PATIENT_VIEWS, type PatientView } from "@/modules/patients/patients.repository";
import { PatientService } from "@/modules/patients/patients.service";
import { departmentLabel, GENDER_LABEL } from "@/modules/patients/patients.validation";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Patients · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEW_LABEL: Record<PatientView, string> = { patients: "Patients", preauth: "Pre-Auth", claims: "Claims" };
const VIEW_EMPTY: Record<PatientView, string> = {
  patients: "No patients yet",
  preauth: "No patients awaiting authorization",
  claims: "No patients in the claim workflow",
};

export default async function PatientsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("patient:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const requested = param(sp, "view");
  const view: PatientView = (PATIENT_VIEWS as readonly string[]).includes(requested ?? "") ? (requested as PatientView) : "patients";
  const data = await PatientService.list(ctx, q, view);
  const canWrite = can(ctx.principal, "patient:write");
  const multiHospital = ctx.principal.orgType !== "hospital";
  // Each view keeps the search; switching views starts at page 1.
  const viewHref = (v: PatientView) => {
    const u = new URLSearchParams();
    if (v !== "patients") u.set("view", v);
    if (q.q) u.set("q", q.q);
    const s = u.toString();
    return s ? `/patients?${s}` : "/patients";
  };

  return (
    <>
      <PageHeader
        title="Patients"
        description={ctx.principal.orgType === "hospital" ? "Patients registered at your hospital." : "Patients linked to requests you can access."}
        actions={canWrite && <ButtonLink href="/patients/new">Register patient</ButtonLink>}
      />
      <Segmented current={view} items={PATIENT_VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v], href: viewHref(v) }))} />
      <Card padded={false}>
        <FilterBar basePath="/patients" q={q.q} searchLabel="Search by name, patient number or mobile">
          {view !== "patients" && <input type="hidden" name="view" value={view} />}
        </FilterBar>
        <DataTable
          caption={view === "patients" ? "Patients" : `Patients · ${VIEW_LABEL[view]}`}
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState title={q.q ? "No patients match your search" : VIEW_EMPTY[view]}>
              {view === "preauth" && !q.q
                ? "Patients appear here while a pre-authorization awaits the payer's decision, and once it is approved until the claim is started."
                : view === "claims" && !q.q
                  ? "Patients appear here once a claim is started — for example with Submit on an approved pre-authorization."
                  : canWrite && !q.q
                    ? "Register a patient to start an eligibility check."
                    : undefined}
            </EmptyState>
          }
          columns={[
            { key: "name", header: "Patient", cell: (r) => <CellLink href={`/patients/${r.id}`} sub={<span className="mono">{r.patientNo}</span>}>{r.fullName}</CellLink> },
            { key: "age", header: "Age / Gender", nowrap: true, cell: (r) => `${ageOn(r.dob)} y · ${r.gender === "undisclosed" ? "—" : GENDER_LABEL[r.gender]}` },
            { key: "department", header: "Department", cell: (r) => departmentLabel(r.department) },
            ...(multiHospital ? [{ key: "hospital", header: "Hospital", cell: (r: (typeof data.rows)[number]) => r.hospitalName }] : []),
            ...(view === "patients"
              ? []
              : [
                  {
                    key: "case",
                    header: view === "preauth" ? "Pre-authorization" : "Claim",
                    cell: (r: (typeof data.rows)[number]) =>
                      r.caseId && r.caseRef ? (
                        <CellText
                          sub={
                            view === "preauth" ? (
                              <Badge tone={STATUS_TONE[r.caseStatus as PreauthStatus]}>{STATUS_LABEL[r.caseStatus as PreauthStatus] ?? r.caseStatus}</Badge>
                            ) : (
                              <Badge tone={CLAIM_STATUS_TONE[r.caseStatus as ClaimStatus]}>{CLAIM_STATUS_LABEL[r.caseStatus as ClaimStatus] ?? r.caseStatus}</Badge>
                            )
                          }
                        >
                          <Link href={view === "preauth" ? `/pre-authorizations/${r.caseId}` : `/claims/${r.caseId}`} className="mono">{r.caseRef}</Link>
                        </CellText>
                      ) : (
                        "—"
                      ),
                  },
                ]),
            { key: "registered", header: "Registered", nowrap: true, cell: (r) => formatDate(r.createdAt) },
          ]}
        />
        {data.total > 0 && (
          <Pagination basePath="/patients" params={{ q: q.q, view: view === "patients" ? undefined : view }} page={q.page} pageSize={q.pageSize} total={data.total} />
        )}
      </Card>
    </>
  );
}
