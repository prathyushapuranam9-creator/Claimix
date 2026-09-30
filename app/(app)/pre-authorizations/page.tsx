import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Pre-authorizations · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEWS: Record<string, { label: string; status?: PreauthStatus[] }> = {
  open: { label: "Open", status: ["draft", "submitted", "pending", "query"] },
  action: { label: "Needs action", status: ["draft", "query"] },
  review: { label: "Awaiting payer", status: ["submitted", "pending"] },
  decided: { label: "Decided", status: ["approved", "partially_approved", "final_approved", "rejected", "settled"] },
  all: { label: "All" },
};

export default async function PreauthListPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("preauth:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const viewKey = param(sp, "view") ?? "open";
  const view = VIEWS[viewKey] ?? VIEWS.open!;
  const data = await PreauthService.list(ctx, q, { status: view.status });
  const isHospital = ctx.principal.orgType === "hospital" && ctx.principal.roleKey !== "patient";

  return (
    <>
      <PageHeader
        title="Pre-authorizations"
        description={isHospital ? "Cashless requests raised by your hospital." : ctx.principal.orgType === "hospital" ? "Your cashless requests." : "Requests submitted to your organization."}
        actions={isHospital && <ButtonLink href="/pre-authorizations/new">New pre-authorization</ButtonLink>}
      />
      <Segmented current={viewKey} items={Object.entries(VIEWS).map(([k, v]) => ({ key: k, label: v.label, href: `/pre-authorizations?view=${k}` }))} />
      <Card padded={false}>
        <FilterBar basePath="/pre-authorizations" q={q.q} searchLabel="Reference or patient name">
          <input type="hidden" name="view" value={viewKey} />
        </FilterBar>
        <DataTable
          caption="Pre-authorizations"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No pre-authorizations here" />}
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
        {data.total > 0 && <Pagination basePath="/pre-authorizations" params={{ q: q.q, view: viewKey }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
