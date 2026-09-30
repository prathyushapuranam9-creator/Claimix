import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { AUDIT_RESOURCE_TYPES, AuditViewer, type AuditFilters } from "@/modules/audit/audit.viewer";
import { CellText, DataTable, Pagination } from "@/components/ui/DataTable";
import { SelectField, TextField } from "@/components/ui/Field";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import styles from "./audit.module.css";

export const metadata: Metadata = { title: "Audit log · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const LINK: Record<string, (id: string) => string> = {
  preauth: (id) => `/pre-authorizations/${id}`,
  claim: (id) => `/claims/${id}`,
  patient: (id) => `/patients/${id}`,
  policy: (id) => `/policies/${id}`,
  user: (id) => `/admin/users/${id}`,
  hospital: (id) => `/hospitals/${id}`,
};

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("audit:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const rt = param(sp, "resourceType");
  const f: AuditFilters = {
    action: param(sp, "action")?.slice(0, 80),
    resourceType: AUDIT_RESOURCE_TYPES.includes(rt as (typeof AUDIT_RESOURCE_TYPES)[number]) ? rt : undefined,
    resourceId: param(sp, "resourceId")?.slice(0, 64),
    actor: param(sp, "actor")?.slice(0, 100),
    from: DATE.test(param(sp, "from") ?? "") ? param(sp, "from") : undefined,
    to: DATE.test(param(sp, "to") ?? "") ? param(sp, "to") : undefined,
  };
  const data = await AuditViewer.list(ctx, q, f);

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins, access and every important change. Entries can't be edited or deleted." />
      <Stack>
        <Alert tone="info">Viewing this log is itself recorded.</Alert>
        <Card padded={false}>
          <form method="get" action="/audit" className={styles.filters} role="search">
            <TextField label="Action starts with" name="action" defaultValue={f.action} placeholder="e.g. claim. or auth.login" />
            <SelectField label="Resource" name="resourceType" defaultValue={f.resourceType ?? ""}>
              <option value="">Any</option>
              {AUDIT_RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </SelectField>
            <TextField label="Resource ID" name="resourceId" defaultValue={f.resourceId} />
            <TextField label="Actor email contains" name="actor" defaultValue={f.actor} />
            <TextField label="From" type="date" name="from" defaultValue={f.from} />
            <TextField label="To" type="date" name="to" defaultValue={f.to} />
            <div className={styles.actions}>
              <Button type="submit" variant="secondary">Apply</Button>
              <ButtonLink href="/audit" variant="ghost">Clear</ButtonLink>
            </div>
          </form>
          <DataTable
            caption="Audit entries"
            rows={data.rows}
            rowKey={(r) => String(r.id)}
            empty={<EmptyState title="No audit entries match" />}
            columns={[
              { key: "t", header: "When", nowrap: true, cell: (r) => <CellText sub={r.requestId ? <span className="mono">{r.requestId.slice(0, 8)}</span> : undefined}>{formatDateTime(r.occurredAt)}</CellText> },
              { key: "a", header: "Actor", cell: (r) => <CellText sub={r.orgName}>{r.actorName ?? (r.actorEmail ? r.actorEmail : "System")}</CellText> },
              { key: "ac", header: "Action", cell: (r) => <span className="mono">{r.action}</span> },
              {
                key: "r",
                header: "Resource",
                cell: (r) =>
                  r.resourceType ? (
                    <CellText sub={r.resourceId ? (LINK[r.resourceType] ? <Link href={LINK[r.resourceType]!(r.resourceId)} className="mono">{r.resourceId.slice(0, 8)}</Link> : <span className="mono">{r.resourceId.slice(0, 8)}</span>) : undefined}>
                      {r.resourceType}
                    </CellText>
                  ) : "—",
              },
              { key: "ip", header: "IP", nowrap: true, cell: (r) => r.ipAddress ?? "—" },
              {
                key: "d",
                header: "Change",
                cell: (r) =>
                  r.previousState || r.newState ? (
                    <details className={styles.change}>
                      <summary>View</summary>
                      {r.previousState && <pre><strong>Before</strong>{"\n"}{JSON.stringify(r.previousState, null, 2)}</pre>}
                      {r.newState && <pre><strong>After</strong>{"\n"}{JSON.stringify(r.newState, null, 2)}</pre>}
                    </details>
                  ) : "—",
              },
            ]}
          />
          {data.total > q.pageSize && (
            <Pagination basePath="/audit" params={{ action: f.action, resourceType: f.resourceType, resourceId: f.resourceId, actor: f.actor, from: f.from, to: f.to }} page={q.page} pageSize={q.pageSize} total={data.total} />
          )}
        </Card>
      </Stack>
    </>
  );
}
