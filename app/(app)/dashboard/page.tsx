import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { pageContext } from "@/lib/auth/context";
import { authService, sessionToken } from "@/lib/auth/session";
import { ContextSwitcher } from "@/components/insurance/ContextSwitcher";
import { exitContextAction, switchContextAction } from "../context/actions";
import { formatDateTime, formatINR } from "@/lib/india";
import { hasDashboard, landingPath } from "@/lib/navigation";
import { can } from "@/lib/permissions/principal";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { DashboardService, type DashboardData } from "@/modules/dashboard/dashboard.service";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { formatHours } from "@/modules/reports/format";
import { CardGrid, ListCard, ListPair, PipelinePill, SectionHeader, WorkflowCard, type CaseRowData } from "@/components/dashboard/DashboardCards";
import { PerformanceGraphs } from "@/components/reports/PerformanceCharts";
import r from "@/components/reports/Reports.module.css";
import { ActionLink, BarMetric, Card as GlassCard, Col, Donut, HospitalPage, Icons, KV, Layout, Metric, Panel, Perf, Queues, RingMetric, Rings, TrendChart, WelcomeCard } from "@/components/dashboard/HospitalDashboard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Badge, Card, EmptyState, PageHeader, Stack, Stat } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Dashboard · Claimix" };

type Row = { id: string; reference: string; status: string; updatedAt: Date };
type Counts = Record<string, number>;

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

/** Case rows for the dashboard list cards (same reference, status and timestamp as CaseList). */
function caseRows(rows: Row[], kind: "preauth" | "claim"): CaseRowData[] {
  return rows.map((x) => ({
    id: x.id,
    href: kind === "preauth" ? `/pre-authorizations/${x.id}` : `/claims/${x.id}`,
    reference: x.reference,
    status:
      kind === "preauth" ? (
        <Badge tone={STATUS_TONE[x.status as PreauthStatus]}>{STATUS_LABEL[x.status as PreauthStatus]}</Badge>
      ) : (
        <Badge tone={CLAIM_STATUS_TONE[x.status as ClaimStatus]}>{CLAIM_STATUS_LABEL[x.status as ClaimStatus]}</Badge>
      ),
    time: formatDateTime(x.updatedAt),
  }));
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

function Money({ d, settle = true }: { d: DashboardData; settle?: boolean }) {
  const t = d.financials.reduce((a, f) => ({ approved: a.approved + f.approved, settled: a.settled + f.settled, claimed: a.claimed + f.claimed }), { approved: 0, settled: 0, claimed: 0 });
  return (
    <>
      <Stat label="Claimed" value={formatINR(t.claimed)} hint="Submitted claims" />
      <Stat label="Approved" value={formatINR(t.approved)} hint="By payer decision" />
      {settle && <Stat label="Settled (paid)" value={formatINR(t.settled)} />}
    </>
  );
}

async function DashboardContent({ switcher }: { switcher?: React.ReactNode }) {
  const ctx = await pageContext("dashboard:view");
  if (!hasDashboard(ctx.principal)) redirect(landingPath(ctx.principal));
  const d = await DashboardService.forCaller(ctx);
  const first = ctx.user.fullName.split(" ")[0];
  const header = <PageHeader title={`Welcome, ${first}`} description={`${ctx.user.roleName} · ${ctx.user.orgName}`} />;

  const ps = d.preauthStatus as Counts;
  const cs = d.claimStatus as Counts;

  if (d.variant === "hospital") {
    const queries = (ps.query ?? 0) + (cs.query ?? 0);
    const drafts = (ps.draft ?? 0) + (cs.draft ?? 0);
    const preauthTotal = Object.values(ps).reduce((a, n) => a + n, 0);
    const caseTotal = preauthTotal + Object.values(cs).reduce((a, n) => a + n, 0);
    // Pre-auths that reached approval. A settled pre-auth was approved first (only a final-approved one can settle),
    // so it stays in this count rather than dropping out when the claim is paid.
    const preauthApproved = sum(ps, ["approved", "partially_approved", "final_approved", "settled"]);
    const t = d.financials.reduce((a, f) => ({ approved: a.approved + f.approved, settled: a.settled + f.settled, claimed: a.claimed + f.claimed }), { approved: 0, settled: 0, claimed: 0 });
    const clock = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
    const trend = d.awaitingTrend.map((p) => ({ label: clock.format(p.at), n: p.n }));
    return (
      <HospitalPage>
        <Layout>
          <Col>
            <WelcomeCard title={`Welcome, ${first}`} subtitle={`${ctx.user.roleName} · ${ctx.user.orgName}`}>
              {can(ctx.principal, "eligibility:check") && <ActionLink href="/eligibility" icon={Icons.search} primary>Check eligibility</ActionLink>}
              {can(ctx.principal, "preauth:create") && <ActionLink href="/pre-authorizations/new" icon={Icons.shield}>New pre-authorization</ActionLink>}
              {can(ctx.principal, "claim:create") && <ActionLink href="/claims/new" icon={Icons.doc}>New claim</ActionLink>}
            </WelcomeCard>
            <Rings>
              <RingMetric label="Queries to answer" value={queries} of={caseTotal} hint="Pre-auths and claims" />
              <RingMetric label="Drafts" value={drafts} of={caseTotal} hint="Not yet submitted" />
              {d.openReviews !== null && <RingMetric label="Assistant reviews" value={d.openReviews} of={d.openReviews} hint="Open questions" />}
            </Rings>
            <Rings>
              <Metric icon={Icons.clock} label="Awaiting payer" value={sum(ps, ["submitted", "pending"]) + sum(cs, ["submitted", "pending"])} href="/pre-authorizations?view=review" />
              <BarMetric icon={Icons.check} label="Pre-auths approved" value={preauthApproved} display={preauthApproved} of={preauthTotal} href="/pre-authorizations?view=approved" />
              <BarMetric icon={Icons.wallet} label="Settled (paid)" value={t.settled} display={formatINR(t.settled)} of={t.approved} href="/claims?view=settled" />
            </Rings>
          </Col>
          <Col side>
            <GlassCard title="Awaiting payer over time" updated={formatDateTime(new Date())}>
              <TrendChart points={trend} />
            </GlassCard>
            <GlassCard title="Claimed and approved">
              <Donut share={t.claimed > 0 ? (t.approved / t.claimed) * 100 : 0}>
                <KV value={formatINR(t.claimed)} label="Claimed · Submitted claims" />
                <KV value={formatINR(t.approved)} label="Approved · By payer decision" />
              </Donut>
            </GlassCard>
            <GlassCard title="Average Processing Time">
              <Perf>
                <KV value={formatHours(d.preauthTat?.avgHours ?? null)} label="Pre-authorizations" />
                <KV value={formatHours(d.claimTat?.avgHours ?? null)} label="Claims" />
              </Perf>
            </GlassCard>
          </Col>
        </Layout>
        <Queues>
          <Panel icon={Icons.doc} title="Pre-authorizations needing action" href="/pre-authorizations">
            <CaseList rows={d.actionPreauths} kind="preauth" empty="Nothing waiting on you" />
          </Panel>
          <Panel icon={Icons.doc} title="Claims needing action" href="/claims">
            <CaseList rows={d.actionClaims} kind="claim" empty="Nothing waiting on you" />
          </Panel>
        </Queues>
        <Disclaimer compact />
      </HospitalPage>
    );
  }

  if (d.variant === "payer") {
    const money = d.financials.reduce((a, f) => ({ approved: a.approved + f.approved, settled: a.settled + f.settled, claimed: a.claimed + f.claimed }), { approved: 0, settled: 0, claimed: 0 });
    const preauthsWaiting = sum(ps, ["submitted", "pending"]);
    const claimsWaiting = sum(cs, ["submitted", "pending"]);
    const queries = (ps.query ?? 0) + (cs.query ?? 0);
    const reviews = d.openReviews;
    const pending = preauthsWaiting + claimsWaiting;
    return (
      <>
        <PageHeader
          title={`Welcome, ${first}`}
          description={`${ctx.user.roleName} · ${ctx.user.orgName}`}
          actions={<PipelinePill label="Decision pipeline" when={`as of ${formatDateTime(new Date())}`} />}
        />
        <Stack>
          {switcher}
          <SectionHeader id="workflows" title="Actionable workflows" chip={`${pending} Pending`} caption="Counts as of page load" />
          <CardGrid columns={4} labelledBy="workflows">
            <WorkflowCard
              label="Pre-auths awaiting decision"
              value={preauthsWaiting}
              accent="blue"
              dot={preauthsWaiting ? "warning" : "muted"}
              caption={preauthsWaiting ? "Immediate review required" : "Nothing waiting"}
              action={preauthsWaiting ? { href: "/pre-authorizations?view=review", text: "View" } : { state: "Zero backlog" }}
            />
            <WorkflowCard
              label="Claims awaiting decision"
              value={claimsWaiting}
              accent="navy"
              dot={claimsWaiting ? "blue" : "muted"}
              caption={claimsWaiting ? "Ready for evaluation" : "Nothing waiting"}
              action={claimsWaiting ? { href: "/claims?view=review", text: "View" } : { state: "Zero backlog" }}
            />
            <WorkflowCard
              label="Queries with hospitals"
              value={queries}
              dot={queries ? "warning" : "muted"}
              caption={queries ? "Waiting on hospital replies" : "All conversations cleared"}
              action={queries ? { href: "/pre-authorizations?view=action", text: "View" } : { state: "Optimal" }}
            />
            {reviews !== null && (
              <WorkflowCard
                label="Assistant reviews"
                value={reviews}
                dot={reviews ? "warning" : "muted"}
                caption="Open questions"
                action={reviews ? { href: "/assistant/reviews", text: "View" } : { state: "Zero backlog" }}
              />
            )}
          </CardGrid>

          <SectionHeader id="performance" title="Performance & financial metrics" chip="All time" chipTone="success" dot="success" caption="INR cumulative" />
          {/* Turnaround (Days) and money (₹) as two bar graphs, from the same dashboard data. */}
          <section aria-labelledby="performance">
            <PerformanceGraphs data={d} />
          </section>

          <ListPair>
            <ListCard
              title="Pre-authorizations awaiting decision"
              count={preauthsWaiting}
              dot="blue"
              href="/pre-authorizations?view=all"
              rows={caseRows(d.actionPreauths, "preauth")}
              empty={<EmptyState title="Nothing awaiting a decision" />}
            />
            <ListCard
              title="Claims awaiting decision"
              count={claimsWaiting}
              dot="navy"
              href="/claims?view=all"
              rows={caseRows(d.actionClaims, "claim")}
              empty={<EmptyState title="Nothing awaiting a decision" />}
            />
          </ListPair>
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
        {switcher}
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

/**
 * The dashboard. Accounts that may use the testing context (administrators and flagged logins for every insurer;
 * insurer / TPA reviewers for their own company) get the Insurance Company and
 * Role selectors at the top; while a context is active the rest of the page is that company's role-specific dashboard.
 */
export default async function DashboardPage() {
  const ctx = await pageContext("dashboard:view");
  if (!ctx.user.canSwitchContext) return <DashboardContent />;
  const options = await authService().contextOptions(await sessionToken());
  // Shown with the payer / administrator dashboard it switches; preselected to the company and role currently in use.
  const inUse = ctx.principal.acting || ctx.principal.orgType === "insurer" || ctx.principal.orgType === "tpa";
  return (
    <DashboardContent
      switcher={
        <ContextSwitcher
          // Re-initialise the form whenever the server-side context changes, so it always shows what is really in use.
          key={`${inUse ? ctx.principal.organizationId : "all"}:${ctx.principal.roleKey}:${ctx.principal.acting ? "ctx" : "own"}`}
          options={options}
          allowAll={ctx.user.homeIsAllInsurers}
          current={inUse ? { organizationId: ctx.principal.organizationId, roleKey: ctx.principal.roleKey } : null}
          active={!!ctx.principal.acting}
          switchAction={switchContextAction}
          exitAction={exitContextAction}
        />
      }
    />
  );
}
