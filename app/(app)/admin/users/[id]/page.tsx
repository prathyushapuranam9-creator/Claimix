import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/india";
import { roleFitsOrg } from "@/lib/permissions/catalog";
import { UserService } from "@/modules/users/users.service";
import { EditUserForm } from "@/components/admin/UserForms";
import { UserSecurityActions } from "@/components/admin/UserSecurityActions";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, PageHeader, Stack } from "@/components/ui/Surface";
import { resendInviteAction, revokeUserSessionsAction, updateUserAction } from "../actions";

export const metadata: Metadata = { title: "User · Claimix" };

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invited?: string }> }) {
  const ctx = await pageContext("user:manage");
  const { id } = await params;
  const { invited } = await searchParams;
  const [u, opts] = await Promise.all([orNotFound(UserService.get(ctx, id)), UserService.formOptions(ctx)]);
  const isSelf = u.id === ctx.principal.userId;
  // Only roles that fit this user's organization type can be chosen.
  const roles = u.roleKey === "patient" ? [{ id: u.roleId, key: u.roleKey, name: u.roleName, orgType: u.orgType }] : opts.roles.filter((r) => roleFitsOrg(r, u.orgType));

  return (
    <>
      <PageHeader
        title={u.fullName}
        description={<>{u.email} {u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>}</>}
      />
      <Stack>
        {invited && <Alert tone="success" title="Invitation sent">The user has been emailed a link to set their password. It expires in 72 hours.</Alert>}
        <Card title="Account">
          <Details columns={3} items={[["Organization", u.orgName], ["Last sign-in", formatDateTime(u.lastLoginAt)], ["Created", formatDateTime(u.createdAt)]]} />
        </Card>
        <Card title="Role and status">
          <EditUserForm action={updateUserAction.bind(null, u.id)} roles={roles} defaults={{ fullName: u.fullName, roleId: u.roleId, isActive: u.isActive, insuranceContext: u.insuranceContext }} isSelf={isSelf} canTestInsurance={u.orgType === "insurer" || u.orgType === "tpa"} />
        </Card>
        <Card title="Security">
          <UserSecurityActions
            revoke={revokeUserSessionsAction.bind(null, u.id)}
            resend={u.isActive ? resendInviteAction.bind(null, u.id) : undefined}
            name={u.fullName}
          />
        </Card>
      </Stack>
    </>
  );
}
