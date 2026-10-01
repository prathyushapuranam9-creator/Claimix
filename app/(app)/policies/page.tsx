import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatINR } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { PolicyService } from "@/modules/policies/policies.service";
import { GOVERNMENT_PRODUCT_TYPES, PRIVATE_PRODUCT_TYPES, PRODUCT_TYPE_LABEL } from "@/modules/policies/policies.validation";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { SelectField } from "@/components/ui/Field";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Policies · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PoliciesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("policy:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const category = param(sp, "category") === "government" ? "government" : "private";
  const types = category === "private" ? PRIVATE_PRODUCT_TYPES : GOVERNMENT_PRODUCT_TYPES;
  const productType = param(sp, "type");
  const f = { category, productType: productType && productType in types ? productType : undefined } as const;
  const data = await PolicyService.list(ctx, q, f);

  return (
    <>
      <PageHeader
        title="Policies & schemes"
        description="Each policy carries its own rules. Rules from one insurer or scheme are never applied to another."
        actions={can(ctx.principal, "policy:manage") && <ButtonLink href="/policies/new">Add policy</ButtonLink>}
      />
      <Segmented
        current={category}
        items={[
          { key: "private", label: "Private insurance", href: "/policies?category=private" },
          { key: "government", label: "Government schemes", href: "/policies?category=government" },
        ]}
      />
      <Card padded={false}>
        <FilterBar basePath="/policies" q={q.q} searchLabel="Policy name">
          <input type="hidden" name="category" value={category} />
          <SelectField label="Product type" name="type" defaultValue={f.productType ?? ""}>
            <option value="">All types</option>
            {Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
        </FilterBar>
        <DataTable
          caption={category === "private" ? "Private insurance policies" : "Government scheme covers"}
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={
            q.q || f.productType ? (
              <EmptyState title="No policies match these filters" />
            ) : (
              <EmptyState title={category === "private" ? "No private insurance policies yet" : "No government scheme covers yet"}>
                {can(ctx.principal, "policy:manage") ? "Add your first policy to get started." : "Policies appear here once an administrator adds them."}
              </EmptyState>
            )
          }
          columns={[
            { key: "name", header: category === "private" ? "Policy" : "Scheme cover", cell: (r) => <CellLink href={`/policies/${r.id}`} sub={PRODUCT_TYPE_LABEL[r.productType]}>{r.name}</CellLink> },
            {
              key: "payer",
              header: category === "private" ? "Insurer / TPA" : "Scheme",
              cell: (r) => (category === "private" ? <CellText sub={r.tpaName ? `TPA: ${r.tpaName}` : "No TPA"}>{r.insurerName}</CellText> : r.schemeName),
            },
            {
              key: "si",
              header: "Sum insured",
              nowrap: true,
              cell: (r) => (r.sumInsuredMax ? (r.sumInsuredMin === r.sumInsuredMax ? formatINR(r.sumInsuredMax) : `${formatINR(r.sumInsuredMin)} – ${formatINR(r.sumInsuredMax)}`) : "Per scheme"),
            },
            { key: "rules", header: "Rules", cell: (r) => (r.activeVersion ? <Badge tone="success">Version {r.activeVersion}</Badge> : <Badge tone="warning">Not published</Badge>) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/policies" params={{ q: q.q, category, type: f.productType }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
