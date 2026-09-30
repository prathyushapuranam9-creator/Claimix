import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { claimFilterParams, CLAIM_VIEWS, parseClaimFilters } from "@/modules/claims/claims.filters";
import { ClaimService } from "@/modules/claims/claims.service";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE } from "@/modules/claims/claims.workflow";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { TpaService } from "@/modules/tpas/tpas.service";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { SelectField, TextField } from "@/components/ui/Field";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Claims · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ClaimsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("claim:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const { view, filters, sort } = parseClaimFilters(sp);
  const isHospital = ctx.principal.orgType === "hospital";
  const isStaff = isHospital && ctx.principal.roleKey !== "patient";
  const [data, insurers, tpas, schemes, hospitals] = await Promise.all([
    ClaimService.list(ctx, q, filters, sort),
    InsurerService.options(ctx),
    TpaService.options(ctx),
    SchemeRepository.options(ctx.db),
    isHospital ? Promise.resolve([]) : OrganizationRepository.options(ctx.db, ["hospital"]),
  ]);
  const params = claimFilterParams(sp);
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const viewHref = (k: string) => `/claims?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([key, v]) => v && key !== "view" && key !== "page")), view: k } as Record<string, string>).toString()}`;

  return (
    <>
      <PageHeader
        title="Claims"
        description={isStaff ? "Final claims from your hospital." : isHospital ? "Your claims." : "Claims submitted to your organization."}
        actions={
          <>
            {can(ctx.principal, "report:view") && <ButtonLink href={`/api/claims/export?${exportQs}`} variant="secondary">Export CSV</ButtonLink>}
            {isStaff && <ButtonLink href="/claims/new">New claim</ButtonLink>}
          </>
        }
      />
      <Segmented current={view} items={Object.entries(CLAIM_VIEWS).map(([k, v]) => ({ key: k, label: v.label, href: viewHref(k) }))} />
      <Card padded={false}>
        <FilterBar
          basePath="/claims"
          q={q.q}
          searchLabel="Claim ID or patient name"
          moreActive={[filters.insurerId, filters.tpaId, filters.schemeId, filters.hospitalId, filters.claimType, filters.from, filters.to].filter(Boolean).length}
          more={
            <>
              <SelectField label="Insurer" name="insurer" defaultValue={filters.insurerId ?? ""}>
                <option value="">Any insurer</option>
                {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </SelectField>
              <SelectField label="TPA" name="tpa" defaultValue={filters.tpaId ?? ""}>
                <option value="">Any TPA</option>
                {tpas.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </SelectField>
              <SelectField label="Scheme" name="scheme" defaultValue={filters.schemeId ?? ""}>
                <option value="">Any scheme</option>
                {schemes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </SelectField>
              {!isHospital && (
                <SelectField label="Hospital" name="hospital" defaultValue={filters.hospitalId ?? ""}>
                  <option value="">Any hospital</option>
                  {hospitals.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </SelectField>
              )}
              <SelectField label="Claim type" name="type" defaultValue={filters.claimType ?? ""}>
                <option value="">Cashless & reimbursement</option>
                <option value="cashless">Cashless</option>
                <option value="reimbursement">Reimbursement</option>
              </SelectField>
              <TextField label="Admitted from" type="date" name="from" defaultValue={filters.from} />
              <TextField label="Admitted to" type="date" name="to" defaultValue={filters.to} />
            </>
          }
        >
          <input type="hidden" name="view" value={view} />
          <SelectField label="Sort by" name="sort" defaultValue={sort}>
            <option value="updated">Last updated</option>
            <option value="admission">Admission date</option>
            <option value="amount">Claim amount</option>
          </SelectField>
        </FilterBar>
        <DataTable
          caption="Claims"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No claims match these filters" />}
          columns={[
            { key: "id", header: "Claim ID", cell: (r) => <CellLink href={`/claims/${r.id}`} sub={r.claimType === "cashless" ? "Cashless" : "Reimbursement"}><span className="mono">{r.reference}</span></CellLink> },
            { key: "st", header: "Status", cell: (r) => <CellText sub={r.lastReason}><Badge tone={CLAIM_STATUS_TONE[r.status]}>{CLAIM_STATUS_LABEL[r.status]}</Badge></CellText> },
            { key: "p", header: "Patient", cell: (r) => <CellText sub={r.policyName}>{r.patientName}</CellText> },
            { key: "payer", header: "Insurer / TPA / scheme", cell: (r) => <CellText sub={r.tpaName ? `TPA: ${r.tpaName}` : undefined}>{r.insurerName ?? r.schemeName}</CellText> },
            ...(isHospital ? [] : [{ key: "h", header: "Hospital", cell: (r: (typeof data.rows)[number]) => r.hospitalName }]),
            { key: "tx", header: "Diagnosis / treatment", cell: (r) => <CellText sub={r.procedureName}>{r.diagnosisCode ?? "—"}</CellText> },
            { key: "d", header: "Admission / discharge", nowrap: true, cell: (r) => <CellText sub={formatDate(r.dischargeDate)}>{formatDate(r.admissionDate)}</CellText> },
            { key: "amt", header: "Claimed / approved", align: "right", cell: (r) => <CellText sub={r.approvedAmount ? `Approved ${formatINR(r.approvedAmount)}` : undefined}>{formatINR(r.claimedAmount)}</CellText> },
            { key: "pt", header: "Patient pays", align: "right", cell: (r) => formatINR(r.patientAmount) },
            { key: "docs", header: "Docs", align: "right", cell: (r) => r.documentCount },
            { key: "u", header: "Updated", nowrap: true, cell: (r) => formatDateTime(r.updatedAt) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/claims" params={params} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
