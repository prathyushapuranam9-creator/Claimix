import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { SelectField } from "@/components/ui/Field";
import { Checkbox } from "@/components/ui/Form";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Hospitals · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function HospitalsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("hospital:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const filters = {
    state: param(sp, "state"),
    insurerId: UUID.test(param(sp, "insurer") ?? "") ? param(sp, "insurer") : undefined,
    schemeId: UUID.test(param(sp, "scheme") ?? "") ? param(sp, "scheme") : undefined,
    cashlessOnly: param(sp, "cashless") === "on",
  };
  const [data, states, insurers, schemes] = await Promise.all([
    HospitalService.list(ctx, q, filters),
    HospitalService.states(ctx),
    InsurerService.options(ctx),
    SchemeRepository.options(ctx.db),
  ]);

  return (
    <>
      <PageHeader
        title="Hospitals & network"
        description="Search by insurer or scheme, then location. Network status must be re-verified with the payer before admission."
        actions={can(ctx.principal, "hospital:manage") && <ButtonLink href="/hospitals/new">Add hospital</ButtonLink>}
      />
      <Card padded={false}>
        <FilterBar basePath="/hospitals" q={q.q} searchLabel="Hospital or city">
          <SelectField label="Insurer network" name="insurer" defaultValue={filters.insurerId ?? ""}>
            <option value="">Any insurer</option>
            {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </SelectField>
          <SelectField label="Government scheme" name="scheme" defaultValue={filters.schemeId ?? ""}>
            <option value="">Any scheme</option>
            {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <SelectField label="State / UT" name="state" defaultValue={filters.state ?? ""}>
            <option value="">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </SelectField>
          <Checkbox label="Cashless only" name="cashless" defaultChecked={filters.cashlessOnly} />
        </FilterBar>
        <DataTable
          caption="Hospitals"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No hospitals match these filters" />}
          columns={[
            { key: "name", header: "Hospital", cell: (r) => <CellLink href={`/hospitals/${r.id}`}>{r.name}</CellLink> },
            { key: "loc", header: "Location", cell: (r) => <CellText sub={r.state}>{r.city}</CellText> },
            { key: "dept", header: "Departments", cell: (r) => r.departments.slice(0, 3).join(", ") + (r.departments.length > 3 ? ` +${r.departments.length - 3}` : "") || "—" },
            {
              key: "net",
              header: "Network",
              cell: (r) => (
                <>
                  {r.networkCount > 0 && <Badge tone="success">{r.networkCount} insurer/TPA</Badge>}{" "}
                  {r.schemeCount > 0 && <Badge tone="info">{r.schemeCount} scheme</Badge>}
                  {r.networkCount + r.schemeCount === 0 && <Badge tone="neutral">None recorded</Badge>}
                </>
              ),
            },
            { key: "ver", header: "Last verified", nowrap: true, cell: (r) => formatDate(r.lastVerifiedAt) },
          ]}
        />
        {data.total > 0 && (
          <Pagination
            basePath="/hospitals"
            params={{ q: q.q, state: filters.state, insurer: filters.insurerId, scheme: filters.schemeId, cashless: filters.cashlessOnly ? "on" : undefined }}
            page={q.page}
            pageSize={q.pageSize}
            total={data.total}
          />
        )}
      </Card>
    </>
  );
}
