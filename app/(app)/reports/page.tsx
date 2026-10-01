import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatDate, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { CLAIM_STATUS_LABEL, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { STATUS_LABEL, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { fillMonths, formatHours, monthLabel, presetRange, type RangePreset } from "@/modules/reports/format";
import { parseRange, ReportService } from "@/modules/reports/reports.service";
import { CaseReportService, parseCaseOptions } from "@/modules/reports/cases-report.service";
import { CasesReportCard, TatDistributionCard } from "@/components/reports/CaseReports";
import { BarList, ColumnChart } from "@/components/reports/Charts";
import r from "@/components/reports/Reports.module.css";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ButtonTabs } from "@/components/ui/ButtonTabs";
import { DataTable } from "@/components/ui/DataTable";
import { TextField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader, Stack, Stat } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Reports · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
];

function statusData<S extends string>(counts: Record<string, number> | null, labels: Record<S, string>) {
  if (!counts) return [];
  return (Object.keys(labels) as S[]).filter((s) => counts[s]).map((s) => ({ label: labels[s], value: counts[s]! }));
}

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("report:view");
  const sp = await searchParams;
  const rangeKey = param(sp, "range");
  const custom = rangeKey === "custom";
  const preset: RangePreset = PRESETS.some((p) => p.key === rangeKey) ? (rangeKey as RangePreset) : "12m";
  const range = custom ? parseRange({ from: param(sp, "from"), to: param(sp, "to") }) : presetRange(preset);
  const caseOpts = parseCaseOptions({ sort: param(sp, "sort"), dir: param(sp, "dir"), page: param(sp, "page") });
  const tab = param(sp, "tab");
  const [data, cases, tat] = await Promise.all([
    ReportService.overview(ctx, range),
    CaseReportService.cases(ctx, range, caseOpts),
    CaseReportService.tatDistribution(ctx, range),
  ]);
  // Query parameters every in-page link keeps (date range + the open tab).
  const rangeParams = custom ? { range: "custom", from: range.from, to: range.to } : { range: preset };

  const totals = data.financials.reduce(
    (a, f) => ({ claimed: a.claimed + f.claimed, approved: a.approved + f.approved, patient: a.patient + f.patient, settled: a.settled + f.settled }),
    { claimed: 0, approved: 0, patient: 0, settled: 0 },
  );
  const monthly = fillMonths(data.monthly, (month) => ({ month, n: 0, claimed: 0, approved: 0 }));
  const exportQs = new URLSearchParams(Object.entries(range).filter(([, v]) => v) as [string, string][]).toString();
  const rangeText = range.from || range.to ? `${range.from ? formatDate(range.from) : "Earliest"} – ${range.to ? formatDate(range.to) : "today"}` : "All time";

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Cases your organization can see · ${rangeText}. Amounts are as recorded from payer decisions.`}
        actions={<ButtonLink href={`/api/reports/export?${exportQs}`} variant="secondary">Export CSV</ButtonLink>}
      />
      <Stack>
        {/* Filters: one row, above everything they scope. */}
        <div className={r.filters}>
          <Segmented
            current={custom ? "custom" : preset}
            items={PRESETS.map((p) => ({ key: p.key, label: p.label, href: `/reports?range=${p.key}${tab ? `&tab=${encodeURIComponent(tab)}` : ""}` }))}
          />
          <form method="get" action="/reports" className={r.custom} aria-label="Custom date range">
            <input type="hidden" name="range" value="custom" />
            {tab && <input type="hidden" name="tab" value={tab} />}
            <TextField label="From" name="from" type="date" defaultValue={custom ? range.from : undefined} />
            <TextField label="To" name="to" type="date" defaultValue={custom ? range.to : undefined} />
            <Button type="submit" variant="secondary">Apply</Button>
          </form>
        </div>

        {/* Report views switch in place (no navigation); the date range above applies to all of them. */}
        <ButtonTabs
          label="Report views"
          urlParam="tab"
          initial={tab}
          tabs={[
            {
              key: "overview",
              label: "Overview",
              panel: (
                <Stack>
              <div className={r.stats}>
                <Stat label="Claimed" value={formatINR(totals.claimed)} hint="Submitted claims" />
                <Stat label="Approved" value={formatINR(totals.approved)} hint="By payer decision" />
                <Stat label="Settled (paid)" value={formatINR(totals.settled)} />
                <Stat label="Patient share" value={formatINR(totals.patient)} hint="On approved claims" />
                <Stat label="Pre-auth turnaround" value={formatHours(data.preauthTat?.medianHours ?? null)} hint={`Median · ${data.preauthTat?.decided ?? 0} decided`} />
                <Stat label="Claim turnaround" value={formatHours(data.claimTat?.medianHours ?? null)} hint={`Median · ${data.claimTat?.decided ?? 0} decided`} />
              </div>

              <Card title="Claims submitted per month">
                {monthly.length === 0 ? (
                  <EmptyState title="No submitted claims in this period" />
                ) : (
                  <ColumnChart label="Claims submitted per month" valueLabel="claims" data={monthly.map((m) => ({ label: monthLabel(m.month), value: m.n }))} />
                )}
              </Card>

              <div className={r.split}>
                <Card title="Pre-authorizations by status">
                  {statusData(data.preauthStatus, STATUS_LABEL as Record<PreauthStatus, string>).length ? (
                    <BarList label="Pre-authorizations by status" data={statusData(data.preauthStatus, STATUS_LABEL as Record<PreauthStatus, string>)} />
                  ) : (
                    <EmptyState title="No pre-authorizations in this period" />
                  )}
                </Card>
                <Card title="Claims by status">
                  {statusData(data.claimStatus, CLAIM_STATUS_LABEL as Record<ClaimStatus, string>).length ? (
                    <BarList label="Claims by status" data={statusData(data.claimStatus, CLAIM_STATUS_LABEL as Record<ClaimStatus, string>)} />
                  ) : (
                    <EmptyState title="No claims in this period" />
                  )}
                </Card>
              </div>

              <Card title="Financial summary by claim type" padded={false}>
                <DataTable
                  caption="Financial summary by claim type"
                  rows={data.financials}
                  rowKey={(f) => f.claimType}
                  empty={<EmptyState title="No claims in this period" />}
                  columns={[
                    { key: "t", header: "Claim type", cell: (f) => (f.claimType === "cashless" ? "Cashless" : "Reimbursement") },
                    { key: "n", header: "Claims", align: "right", cell: (f) => f.claims.toLocaleString("en-IN") },
                    { key: "c", header: "Claimed", align: "right", cell: (f) => formatINR(f.claimed) },
                    { key: "a", header: "Approved", align: "right", cell: (f) => formatINR(f.approved) },
                    { key: "p", header: "Patient share", align: "right", cell: (f) => formatINR(f.patient) },
                    { key: "s", header: "Settled (paid)", align: "right", cell: (f) => formatINR(f.settled) },
                  ]}
                />
              </Card>

              <div className={r.split}>
                <Card title="Turnaround" padded={false}>
                  <DataTable
                    caption="Turnaround from submission to payer decision"
                    rows={[
                      { key: "Pre-authorizations", t: data.preauthTat },
                      { key: "Claims", t: data.claimTat },
                    ].filter((x) => x.t)}
                    rowKey={(x) => x.key}
                    columns={[
                      { key: "k", header: "Cases", cell: (x) => x.key },
                      { key: "m", header: "Median", align: "right", cell: (x) => formatHours(x.t!.medianHours) },
                      { key: "a", header: "Average", align: "right", cell: (x) => formatHours(x.t!.avgHours) },
                      { key: "d", header: "Decided", align: "right", cell: (x) => x.t!.decided },
                      { key: "w", header: "Awaiting", align: "right", cell: (x) => x.t!.awaiting },
                    ]}
                  />
                  <p className={r.cardNote}>From submission to the payer&apos;s first approval, partial approval or rejection. Time spent on queries is included.</p>
                </Card>
                <Card title="Top query & rejection reasons" padded={false}>
                  <DataTable
                    caption="Top query and rejection reasons"
                    rows={data.reasons}
                    rowKey={(x) => x.code}
                    empty={<EmptyState title="No queries or rejections recorded in this period" />}
                    columns={[
                      { key: "r", header: "Reason", cell: (x) => x.title },
                      { key: "q", header: "Queries", align: "right", cell: (x) => x.queries },
                      { key: "j", header: "Rejections", align: "right", cell: (x) => x.rejections },
                    ]}
                  />
                </Card>
              </div>
                </Stack>
              ),
            },
            {
              key: "cases",
              label: "Cases",
              panel: <CasesReportCard data={cases} sort={caseOpts.sort} dir={caseOpts.dir} params={{ ...rangeParams, tab: "cases" }} />,
            },
            {
              key: "tat",
              label: "TAT distribution",
              panel: <TatDistributionCard data={tat} />,
            },
          ]}
        />
      </Stack>
    </>
  );
}
