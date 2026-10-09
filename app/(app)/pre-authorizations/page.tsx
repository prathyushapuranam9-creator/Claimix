import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { scopeFor } from "@/lib/permissions/principal";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { TpaService } from "@/modules/tpas/tpas.service";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { SelectField } from "@/components/ui/Field";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Pre-authorizations · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEWS: Record<string, { label: string; status?: PreauthStatus[] }> = {
  open: { label: "Open", status: ["draft", "submitted", "pending", "query"] },
  action: { label: "Needs action", status: ["draft", "query"] },
  review: { label: "Awaiting payer", status: ["submitted", "pending"] },
  // Approved only (no rejections); matches the dashboard's "Pre-auths approved" count.
  approved: { label: "Approved", status: ["approved", "partially_approved", "final_approved", "settled"] },
  decided: { label: "Decided", status: ["approved", "partially_approved", "final_approved", "rejected", "settled"] },
  all: { label: "All" },
};

export default async function PreauthListPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("preauth:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const viewKey = param(sp, "view") ?? "open";
  const view = VIEWS[viewKey] ?? VIEWS.open!;
  // Insurer / TPA / hospital filters are for users who see across organizations (administrators, insurance operations).
  const crossOrg = scopeFor(ctx.principal, "preauth:read") === "all";
  const uuid = (k: string) => {
    const v = param(sp, k);
    return crossOrg && v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
  };
  const filters = { insurerId: uuid("insurer"), tpaId: uuid("tpa"), hospitalId: uuid("hospital") };
  const filterQs = { insurer: filters.insurerId, tpa: filters.tpaId, hospital: filters.hospitalId };
  const [data, insurers, tpas, hospitals] = await Promise.all([
    PreauthService.list(ctx, q, { status: view.status, ...filters }),
    crossOrg ? InsurerService.options(ctx) : Promise.resolve([]),
    crossOrg ? TpaService.options(ctx) : Promise.resolve([]),
    crossOrg ? OrganizationRepository.options(ctx.db, ["hospital"]) : Promise.resolve([]),
  ]);
  // Only when this view is empty: are there any requests at all? (decides the empty-state wording)
  const anyPreauths = data.total > 0 || (await PreauthService.list(ctx, { page: 1, pageSize: 1 }, {})).total > 0;
  const isHospital = ctx.principal.orgType === "hospital" && ctx.principal.roleKey !== "patient";
  // Insurer / TPA reviewers raise a cashless request on the hospital's behalf (New Claim wizard).
  const canRaise = (ctx.principal.orgType === "insurer" || ctx.principal.orgType === "tpa") && !!scopeFor(ctx.principal, "preauth:raise");

  return (
    <>
      <PageHeader
        title="Pre-authorizations"
        description={isHospital ? "Cashless requests raised by your hospital." : ctx.principal.orgType === "hospital" ? "Your cashless requests." : crossOrg ? "Submitted requests across insurers and TPAs." : "Requests submitted to your organization."}
        actions={
          isHospital ? (
            <ButtonLink href="/pre-authorizations/new">New pre-authorization</ButtonLink>
          ) : canRaise ? (
            <ButtonLink href="/pre-authorizations/raise">New Claim</ButtonLink>
          ) : null
        }
      />
      <Segmented
        current={viewKey}
        items={Object.entries(VIEWS).map(([k, v]) => ({
          key: k,
          label: v.label,
          href: `/pre-authorizations?${new URLSearchParams({ view: k, ...Object.fromEntries(Object.entries(filterQs).filter(([, x]) => x)) } as Record<string, string>).toString()}`,
        }))}
      />
      <Card padded={false}>
        <FilterBar
          basePath="/pre-authorizations"
          q={q.q}
          searchLabel="Reference or patient name"
          moreActive={crossOrg ? Object.values(filterQs).filter(Boolean).length : 0}
          more={
            crossOrg ? (
              <>
                <SelectField label="Insurer" name="insurer" defaultValue={filters.insurerId ?? ""}>
                  <option value="">Any insurer</option>
                  {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </SelectField>
                <SelectField label="TPA" name="tpa" defaultValue={filters.tpaId ?? ""}>
                  <option value="">Any TPA</option>
                  {tpas.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </SelectField>
                <SelectField label="Hospital" name="hospital" defaultValue={filters.hospitalId ?? ""}>
                  <option value="">Any hospital</option>
                  {hospitals.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </SelectField>
              </>
            ) : undefined
          }
        >
          <input type="hidden" name="view" value={viewKey} />
        </FilterBar>
        <DataTable
          caption="Pre-authorizations"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={
            anyPreauths ? (
              <EmptyState title="No pre-authorizations here" />
            ) : (
              <EmptyState title="No pre-authorizations yet">
                {ctx.principal.orgType === "hospital" && ctx.principal.roleKey !== "patient" ? "Create your first pre-authorization to get started." : "Requests appear here once they are submitted."}
              </EmptyState>
            )
          }
          columns={[
            { key: "ref", header: "Reference", cell: (r) => <CellLink href={`/pre-authorizations/${r.id}`} sub={r.patientName}><span className="mono">{r.reference}</span></CellLink> },
            { key: "st", header: "Status", cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
            { key: "pol", header: "Policy / payer", cell: (r) => <CellText sub={r.insurerName ?? r.schemeName}>{r.policyName}</CellText> },
            ...(isHospital ? [] : [{ key: "h", header: "Hospital", cell: (r: (typeof data.rows)[number]) => r.hospitalName }]),
            { key: "tx", header: "Treatment", cell: (r) => <CellText sub={r.expectedAdmission ? `Admission ${formatDate(r.expectedAdmission)}` : undefined}>{r.procedureName ?? "—"}</CellText> },
            { key: "amt", header: "Estimate / approved", align: "right", cell: (r) => <CellText sub={r.approvedAmount ? `Approved ${formatINR(r.approvedAmount)}` : undefined}>{formatINR(r.estimatedCost)}</CellText> },
            { key: "u", header: "Updated", nowrap: true, cell: (r) => formatDateTime(r.updatedAt) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/pre-authorizations" params={{ q: q.q, view: viewKey, ...filterQs }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
