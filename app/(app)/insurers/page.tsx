import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Insurance companies · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function InsurersPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("insurer:read");
  const q = parseListQuery(await searchParams);
  const data = await InsurerService.list(ctx, q);
  return (
    <>
      <PageHeader
        title="Insurance companies"
        description="Private health insurers. Each insurer's policies carry their own rules."
        actions={can(ctx.principal, "insurer:manage") && <ButtonLink href="/insurers/new">Add insurer</ButtonLink>}
      />
      <Card padded={false}>
        <FilterBar basePath="/insurers" q={q.q} searchLabel="Search by name or code" />
        <DataTable
          caption="Insurance companies"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No insurers found" />}
          columns={[
            { key: "name", header: "Insurer", cell: (r) => <CellLink href={`/insurers/${r.id}`}>{r.name}</CellLink> },
            { key: "code", header: "Code", cell: (r) => <span className="mono">{r.code}</span> },
            { key: "phone", header: "Claims helpline", nowrap: true, cell: (r) => r.claimsPhone ?? "—" },
            { key: "pol", header: "Policies", align: "right", cell: (r) => r.policyCount },
            { key: "net", header: "Network hospitals", align: "right", cell: (r) => r.networkCount },
            { key: "st", header: "Status", cell: (r) => (r.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/insurers" params={{ q: q.q }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
