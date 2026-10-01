import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/auth/context";
import { formatDateTime, formatINR } from "@/lib/india";
import { can } from "@/lib/permissions/principal";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { DashboardService, type DashboardData } from "@/modules/dashboard/dashboard.service";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { formatHours } from "@/modules/reports/format";
import r from "@/components/reports/Reports.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Badge, Card, EmptyState, PageHeader, Stack, Stat } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Dashboard · Claimix" };

type Row = { id: string; reference: string; status: string; updatedAt: Date };
type Counts = Record<string, number>;
type CaseData = Exclude<DashboardData, { variant: "patient" } | { variant: "reference" }>;

const sum = (c: Counts, keys: string[]) => keys.reduce((a, k) => a + (c[k] ?? 0), 0);

function CaseList({ rows, kind, empty }: { rows: Row[]; kind: "preauth" | "claim"; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <ul className={r.list}>
      {rows.map((x) => (
        <li key={x.id}>
          <Link href={kind === "preauth" ? `/pre-authorizations/${x.id}` : `/claims/${x.id}`}>{x.reference}</Link>
          <span>
            {kind === "preauth" ? (
              <Badge tone={STATUS_TONE[x.status as PreauthStatus]}>{STATUS_LABEL[x.status as PreauthStatus]}</Badge>
            ) : (
              <Badge tone={CLAIM_STATUS_TONE[x.status as ClaimStatus]}>{CLAIM_STATUS_LABEL[x.status as ClaimStatus]}</Badge>
            )}{" "}
            <small>{formatDateTime(x.updatedAt)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

type Metric = { label: string; value: React.ReactNode; hint?: string };

function Group({ title, metrics, size }: { title: string; metrics: Metric[]; size: "Sm" | "Md" | "Lg" }) {
  return (
    <section className={`${r.group} ${r[`group${size}`]}`}>
      <h2 className={r.groupTitle}>{title}</h2>
      <div className={r.groupBody}>
        {metrics.map((m) => (
          <div key={m.label} className={r.metric}>
            <span className={r.metricValue}>{m.value}</span>
            <span className={r.metricLabel}>{m.label}</span>
            {m.hint && <span className={r.metricHint}>{m.hint}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Money({ d }: { d: CaseData }) {
  const t = d.financials.reduce((a, f) => ({ approved: a.approved + f.approved, settled: a.settled + f.settled, claimed: a.claimed + f.claimed }), { approved: 0, settled: 0, claimed: 0 });
  return (
    <>
      <Stat label="Claimed" value={formatINR(t.claimed)} hint="Submitted claims" />
      <Stat label="Approved" value={formatINR(t.approved)} hint="By payer decision" />
      <Stat label="Settled (paid)" value={formatINR(t.settled)} />
    </>
  );
}

export default async function DashboardPage() {
  const ctx = await pageContext("dashboard:view");
  const d = await DashboardService.forCaller(ctx);
  const first = ctx.user.fullName.split(" ")[0];
  const header = <PageHeader title={`Welcome, ${first}`} description={`${ctx.user.roleName} · ${ctx.user.orgName}`} />;

  if (d.variant === "patient") {
    return (
      <>
        {header}
        <Stack>
          <div className={r.split}>
            <Card title="Your pre-authorizations"><CaseList rows={d.preauths} kind="preauth" empty="No pre-authorizations yet" /></Card>
            <Card title="Your claims"><CaseList rows={d.claims} kind="claim" empty="No claims yet" /></Card>
          </div>
          <Card title="Understand your cover">
            <p>
              <Link href="/knowledge/how-cashless-works">How cashless works</Link> · <Link href="/cashless-vs-reimbursement">Cashless vs reimbursement</Link> · <Link href="/glossary">Glossary</Link>
            </p>
          </Card>
          <Disclaimer compact />
        </Stack>
      </>
    );
  }

  if (d.variant === "reference") {
    const x = d.reference;
    return (
      <>
        {header}
        <Stack>
          <div className={r.stats}>
            <Stat label="Hospitals" value={x.hospitals} />
            <Stat label="Insurance companies" value={x.insurers} />
            <Stat label="TPAs" value={x.tpas} />
            <Stat label="Government schemes" value={x.schemes} />
            <Stat label="Policies" value={x.policies} />
          </div>
          <Card title="Browse">
            <p>
              <Link href="/hospitals">Hospitals &amp; network</Link> · <Link href="/policies">Policies</Link> · <Link href="/insurers">Insurance companies</Link> · <Link href="/knowledge">Knowledge Center</Link>
            </p>
          </Card>
        </Stack>
      </>
    );
  }

  const ps = d.preauthStatus as Counts;
  const cs = d.claimStatus as Counts;

  if (d.variant === "hospital") {
    const queries = (ps.query ?? 0) + (cs.query ?? 0);
    const drafts = (ps.draft ?? 0) + (cs.draft ?? 0);
    return (
      <>
        {header}
        <Stack>
          <div className={r.filters}>
            {can(ctx.principal, "eligibility:check") && <ButtonLink href="/eligibility">Check eligibility</ButtonLink>}
            {can(ctx.principal, "preauth:create") && <ButtonLink href="/pre-authorizations/new" variant="secondary">New pre-authorization</ButtonLink>}
            {can(ctx.principal, "claim:create") && <ButtonLink href="/claims/new" variant="secondary">New claim</ButtonLink>}
          </div>
          <div className={r.stats}>
            <Stat label="Queries to answer" value={queries} hint="Pre-auths and claims" />
            <Stat label="Drafts" value={drafts} hint="Not yet submitted" />
            <Stat label="Awaiting payer" value={sum(ps, ["submitted", "pending"]) + sum(cs, ["submitted", "pending"])} />
            <Stat label="Pre-auths approved" value={sum(ps, ["approved", "partially_approved", "final_approved"])} />
            <Money d={d} />
            {d.openReviews !== null && <Stat label="Assistant reviews" value={d.openReviews} hint="Open questions" />}
          </div>
          <div className={r.split}>
            <Card title="Pre-authorizations needing action" actions={<Link href="/pre-authorizations">All</Link>}>
              <CaseList rows={d.actionPreauths} kind="preauth" empty="Nothing waiting on you" />
            </Card>
            <Card title="Claims needing action" actions={<Link href="/claims">All</Link>}>
              <CaseList rows={d.actionClaims} kind="claim" empty="Nothing waiting on you" />
            </Card>
          </div>
          <Disclaimer compact />
        </Stack>
      </>
    );
  }

  if (d.variant === "payer") {
    return (
      <>
        {header}
        <Stack>
          <div className={r.stats}>
            <Stat label="Pre-auths awaiting decision" value={sum(ps, ["submitted", "pending"])} />
            <Stat label="Claims awaiting decision" value={sum(cs, ["submitted", "pending"])} />
            <Stat label="Queries with hospitals" value={(ps.query ?? 0) + (cs.query ?? 0)} />
            <Stat label="Pre-auth turnaround" value={formatHours(d.preauthTat?.medianHours ?? null)} hint="Median" />
            <Stat label="Claim turnaround" value={formatHours(d.claimTat?.medianHours ?? null)} hint="Median" />
            <Money d={d} />
            {d.openReviews !== null && <Stat label="Assistant reviews" value={d.openReviews} hint="Open questions" />}
          </div>
          <div className={r.split}>
            <Card title="Pre-authorizations awaiting decision" actions={<Link href="/pre-authorizations">All</Link>}>
              <CaseList rows={d.actionPreauths} kind="preauth" empty="Nothing awaiting a decision" />
            </Card>
            <Card title="Claims awaiting decision" actions={<Link href="/claims">All</Link>}>
              <CaseList rows={d.actionClaims} kind="claim" empty="Nothing awaiting a decision" />
            </Card>
          </div>
        </Stack>
      </>
    );
  }

  // Administrator
  const adminTotals = d.financials.reduce((t, f) => ({ approved: t.approved + f.approved, settled: t.settled + f.settled, claimed: t.claimed + f.claimed }), { approved: 0, settled: 0, claimed: 0 });
  return (
    <>
      {header}
      <Stack>
        <div className={r.groups}>
          {d.admin && (
            <>
              <Group size="Sm" title="Users & Patients" metrics={[
                { label: "Active users", value: d.admin.activeUsers },
                { label: "Patients", value: d.admin.patients },
              ]} />
              <Group size="Sm" title="System issues" metrics={[
                { label: "Access requests", value: <Link href="/admin/access-requests">{d.admin.pendingAccessRequests}</Link>, hint: "Pending review" },
                { label: "Failed jobs", value: d.admin.failedJobs, hint: "Emails and scans" },
              ]} />
            </>
          )}
          <Group size="Sm" title="Awaiting action" metrics={[
            { label: "Pre-auths awaiting payer", value: sum(ps, ["submitted", "pending"]) },
            { label: "Claims awaiting payer", value: sum(cs, ["submitted", "pending"]) },
            { label: "Open queries", value: (ps.query ?? 0) + (cs.query ?? 0) },
            { label: "Claims rejected", value: cs.rejected ?? 0 },
          ]} />
          <Group size="Lg" title="Financial (₹)" metrics={[
            { label: "Claimed", value: formatINR(adminTotals.claimed), hint: "Submitted claims" },
            { label: "Approved", value: formatINR(adminTotals.approved), hint: "By payer decision" },
            { label: "Settled (paid)", value: formatINR(adminTotals.settled) },
          ]} />
          {d.openReviews !== null && (
            <Group size="Sm" title="Assistant" metrics={[{ label: "Assistant reviews", value: d.openReviews, hint: "Open questions" }]} />
          )}
        </div>
        <div className={r.split}>
          <Card title="Pre-authorizations awaiting payer" actions={<Link href="/pre-authorizations">All</Link>}>
            <CaseList rows={d.actionPreauths} kind="preauth" empty="Nothing awaiting a payer" />
          </Card>
          <Card title="Claims awaiting payer" actions={<Link href="/claims">All</Link>}>
            <CaseList rows={d.actionClaims} kind="claim" empty="Nothing awaiting a payer" />
          </Card>
        </div>
        <p className={r.note}><Link href="/reports">Open reports</Link> for trends, turnaround and top reasons.</p>
      </Stack>
    </>
  );
}
