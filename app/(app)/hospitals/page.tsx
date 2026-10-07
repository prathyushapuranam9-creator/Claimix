import type { Metadata } from "next";
import { Suspense } from "react";
import { pageContext, type ServiceContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/india";
import { logger } from "@/lib/logging/logger";
import { param, parseListQuery, type ListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { SelectField } from "@/components/ui/Field";
import { Alert, Badge, Card, EmptyState, LoadingState, PageHeader, Stack } from "@/components/ui/Surface";
import { Toggle } from "@/components/ui/Toggle";
import styles from "./hospitals.module.css";

/** Departments shown before "+N more". */
const DEPT_SHOWN = 3;

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
  const [states, insurers, schemes] = await Promise.all([
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
      <Stack>
        {/* Search and filters: one elevated panel above the results they scope. */}
        <div className={styles.filterCard}>
          <Card padded={false}>
            <FilterBar basePath="/hospitals" q={q.q} searchLabel="Hospital or city" searchPlaceholder="Name or city" searchIcon>
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
              <Toggle label="Cashless only" name="cashless" defaultChecked={filters.cashlessOnly} />
            </FilterBar>
          </Card>
        </div>
        <Suspense key={JSON.stringify([q, filters])} fallback={<Card><LoadingState label="Loading hospitals…" /></Card>}>
          <HospitalResults ctx={ctx} q={q} filters={filters} />
        </Suspense>
      </Stack>
    </>
  );
}

type Filters = { state?: string; insurerId?: string; schemeId?: string; cashlessOnly: boolean };

/** The results: loads on its own (with a loading state), and shows an error card instead of failing the page. */
async function HospitalResults({ ctx, q, filters }: { ctx: ServiceContext; q: ListQuery; filters: Filters }) {
  let data;
  try {
    data = await HospitalService.list(ctx, q, filters);
  } catch (e) {
    logger.error("hospital_list_failed", { error: e });
    return (
      <Card>
        <Alert tone="danger">Unable to load hospitals. Please try again.</Alert>
      </Card>
    );
  }
  return (
    <Card padded={false}>
      <DataTable
        caption="Hospitals"
        rows={data.rows}
        rowKey={(r) => r.id}
        empty={
          q.q || filters.state || filters.insurerId || filters.schemeId || filters.cashlessOnly ? (
            <EmptyState title="No hospitals match these filters" />
          ) : (
            <EmptyState title="No hospitals yet">{can(ctx.principal, "hospital:manage") ? "Add your first hospital to get started." : "Hospitals appear here once an administrator adds them."}</EmptyState>
          )
        }
        columns={[
          { key: "name", header: "Hospital", cell: (r) => <span className={styles.name}><CellLink href={`/hospitals/${r.id}`}>{r.name}</CellLink></span> },
          { key: "loc", header: "Location", cell: (r) => <CellText sub={r.state}>{r.city}</CellText> },
          {
            key: "dept",
            header: "Departments",
            cell: (r) =>
              r.departments.length === 0 ? (
                <span className={styles.muted}>—</span>
              ) : (
                <span className={styles.tags} title={r.departments.join(", ")}>
                  {r.departments.slice(0, DEPT_SHOWN).map((d) => <span key={d} className={styles.tag}>{d}</span>)}
                  {r.departments.length > DEPT_SHOWN && <span className={styles.more}>+{r.departments.length - DEPT_SHOWN} more</span>}
                </span>
              ),
          },
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
          {
            key: "ver",
            header: "Last verified",
            nowrap: true,
            cell: (r) =>
              r.lastVerifiedAt ? (
                <span className={styles.verified}>
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {formatDate(r.lastVerifiedAt)}
                </span>
              ) : (
                <span className={styles.muted}>Not verified</span>
              ),
          },
          { key: "act", header: "", nowrap: true, cell: (r) => <ButtonLink href={`/hospitals/${r.id}`} variant="secondary" size="sm">View details</ButtonLink> },
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
  );
}
