import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { AccessRequestService } from "@/modules/access-requests/access-requests.service";
import { ORGANIZATION_TYPES } from "@/modules/access-requests/access-requests.validation";
import { AccessRequestDecision } from "@/components/admin/AccessRequestDecision";
import { CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";
import { decideAccessRequestAction } from "./actions";

export const metadata: Metadata = { title: "Access requests · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATUSES = ["pending", "approved", "declined"] as const;
type Status = (typeof STATUSES)[number];
const TONE = { pending: "warning", approved: "success", declined: "neutral" } as const;

export default async function AccessRequestsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("user:manage");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const statusParam = param(sp, "status") ?? "pending";
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as Status) : undefined;
  const data = await AccessRequestService.list(ctx, q, status);
  const typeLabel = (v: string) => ORGANIZATION_TYPES.find((o) => o.value === v)?.label ?? v;

  return (
    <>
      <PageHeader title="Access requests" description="Requests from the public registration form. Nothing is created automatically." />
      <Alert tone="info">
        Approving records your decision only. To give access, verify the organization, then <Link href="/admin/users/new">invite the user</Link> with the right role.
      </Alert>
      <Segmented
        current={status ?? "all"}
        items={[
          { key: "pending", label: "Pending", href: "/admin/access-requests?status=pending" },
          { key: "approved", label: "Approved", href: "/admin/access-requests?status=approved" },
          { key: "declined", label: "Declined", href: "/admin/access-requests?status=declined" },
          { key: "all", label: "All", href: "/admin/access-requests?status=all" },
        ]}
      />
      <Card padded={false}>
        <FilterBar basePath="/admin/access-requests" q={q.q} searchLabel="Name, email or organization">
          <input type="hidden" name="status" value={status ?? "all"} />
        </FilterBar>
        <DataTable
          caption="Access requests"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No access requests here" />}
          columns={[
            { key: "who", header: "Requester", cell: (r) => <CellText sub={r.email}>{r.fullName}</CellText> },
            { key: "org", header: "Organization", cell: (r) => <CellText sub={[typeLabel(r.organizationType), r.jobTitle].filter(Boolean).join(" · ")}>{r.organizationName}</CellText> },
            { key: "msg", header: "Message", cell: (r) => <CellText sub={r.phone ?? undefined}>{r.message ?? "—"}</CellText> },
            { key: "at", header: "Received", nowrap: true, cell: (r) => formatDateTime(r.createdAt) },
            {
              key: "status",
              header: "Status",
              cell: (r) =>
                r.status === "pending" ? (
                  <AccessRequestDecision name={r.fullName} action={decideAccessRequestAction.bind(null, r.id)} />
                ) : (
                  <CellText sub={[r.reviewerName, formatDateTime(r.reviewedAt), r.reviewNote].filter(Boolean).join(" · ")}>
                    <Badge tone={TONE[r.status]}>{r.status === "approved" ? "Approved" : "Declined"}</Badge>
                  </CellText>
                ),
            },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/admin/access-requests" params={{ q: q.q, status: status ?? "all" }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
