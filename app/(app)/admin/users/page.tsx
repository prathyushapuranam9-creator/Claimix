import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { UserService } from "@/modules/users/users.service";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, FilterBar, Pagination } from "@/components/ui/DataTable";
import { SelectField } from "@/components/ui/Field";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Users · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function UsersPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("user:manage");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const opts = await UserService.formOptions(ctx);
  const orgParam = param(sp, "org");
  const roleParam = param(sp, "role");
  const f = {
    organizationId: opts.orgs.some((o) => o.id === orgParam) ? orgParam : undefined,
    roleKey: ["admin", "hospital_staff", "payer_reviewer", "patient", "read_only"].includes(roleParam ?? "") ? roleParam : undefined,
  };
  const data = await UserService.list(ctx, q, f);

  return (
    <>
      <PageHeader title="Users" description="Accounts, roles and organization membership." actions={<ButtonLink href="/admin/users/new">Invite user</ButtonLink>} />
      <Card padded={false}>
        <FilterBar basePath="/admin/users" q={q.q} searchLabel="Name or email">
          <SelectField label="Organization" name="org" defaultValue={f.organizationId ?? ""}>
            <option value="">All organizations</option>
            {opts.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </SelectField>
          <SelectField label="Role" name="role" defaultValue={f.roleKey ?? ""}>
            <option value="">All roles</option>
            <option value="admin">Administrator</option>
            <option value="hospital_staff">Hospital Staff</option>
            <option value="payer_reviewer">Payer Reviewer</option>
            <option value="patient">Patient</option>
            <option value="read_only">Read-only</option>
          </SelectField>
        </FilterBar>
        <DataTable
          caption="Users"
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No users match" />}
          columns={[
            { key: "name", header: "User", cell: (r) => <CellLink href={`/admin/users/${r.id}`} sub={r.email}>{r.fullName}</CellLink> },
            { key: "role", header: "Role", cell: (r) => r.roleName },
            { key: "org", header: "Organization", cell: (r) => r.orgName },
            { key: "login", header: "Last sign-in", nowrap: true, cell: (r) => <CellText>{formatDateTime(r.lastLoginAt)}</CellText> },
            { key: "st", header: "Status", cell: (r) => (r.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>) },
          ]}
        />
        {data.total > 0 && <Pagination basePath="/admin/users" params={{ q: q.q, org: f.organizationId, role: f.roleKey }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
