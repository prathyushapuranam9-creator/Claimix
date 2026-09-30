import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { TpaService } from "@/modules/tpas/tpas.service";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "TPAs · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TpasPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("insurer:read");
  const q = parseListQuery(await searchParams);
  const data = await TpaService.list(ctx, q);
  return (
    <>
      <PageHeader
        title="Third-party administrators"
        description="TPAs process cashless requests and claims on behalf of insurers. The insurer's policy rules still apply."
        actions={can(ctx.principal, "insurer:manage") && <ButtonLink href="/tpas/new">Add TPA</ButtonLink>}
      />
      <Card padded={false}>
        <FilterBar basePath="/tpas" q={q.q} searchLabel="Search by name or code" />
        <DataTable
          caption="TPAs"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No TPAs found" />}
          columns={[
            { key: "name", header: "TPA", cell: (r) => <CellLink href={`/tpas/${r.id}`}>{r.name}</CellLink> },
            { key: "code", header: "Code", cell: (r) => <span className="mono">{r.code}</span> },
            { key: "phone", header: "Phone", nowrap: true, cell: (r) => r.phone ?? "—" },
            { key: "pol", header: "Policies serviced", align: "right", cell: (r) => r.policyCount },
            { key: "st", header: "Status", cell: (r) => (r.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/tpas" params={{ q: q.q }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
