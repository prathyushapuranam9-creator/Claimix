import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import styles from "./insurers.module.css";

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
      <Stack>
        {/* Search: its own raised panel above the results. */}
        <div className={styles.filterCard}>
          <Card padded={false}>
            <FilterBar basePath="/insurers" q={q.q} searchLabel="Search by name or code" searchPlaceholder="Insurer name or code" searchIcon />
          </Card>
        </div>
        <Card padded={false}>
        <DataTable
          caption="Insurance companies"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={
            q.q ? (
              <EmptyState title="No insurers match your search" />
            ) : (
              <EmptyState title="No insurers yet">{can(ctx.principal, "insurer:manage") ? "Add your first insurance company to get started." : "Insurers appear here once an administrator adds them."}</EmptyState>
            )
          }
          columns={[
            { key: "name", header: "Insurer", cell: (r) => <span className={styles.name}><CellLink href={`/insurers/${r.id}`}>{r.name}</CellLink></span> },
            { key: "code", header: "Code", cell: (r) => <span className="mono">{r.code}</span> },
            { key: "phone", header: "Claims helpline", nowrap: true, cell: (r) => r.claimsPhone ?? "—" },
            {
              key: "pol",
              header: "Policies",
              align: "right",
              cell: (r) => (
                <Link className={styles.pill} href={`/policies?insurer=${r.id}`} aria-label={`${r.policyCount} ${r.policyCount === 1 ? "policy" : "policies"} of ${r.name}`}>
                  {r.policyCount}
                </Link>
              ),
            },
            {
              key: "net",
              header: "Network hospitals",
              align: "right",
              cell: (r) => (
                <Link className={`${styles.pill} ${styles.pillGreen}`} href={`/hospitals?insurer=${r.id}`} aria-label={`${r.networkCount} network ${r.networkCount === 1 ? "hospital" : "hospitals"} of ${r.name}`}>
                  {r.networkCount}
                </Link>
              ),
            },
            { key: "st", header: "Status", cell: (r) => (r.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/insurers" params={{ q: q.q }} page={q.page} pageSize={q.pageSize} total={data.total} />}
        </Card>
      </Stack>
    </>
  );
}
