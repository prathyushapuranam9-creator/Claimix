import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { UserService } from "@/modules/users/users.service";
import { CreateUserForm } from "@/components/admin/UserForms";
import { Card, PageHeader } from "@/components/ui/Surface";
import { createUserAction } from "../actions";

export const metadata: Metadata = { title: "Invite user · Claimix" };

export default async function NewUserPage() {
  const ctx = await pageContext("user:manage");
  const { roles, orgs } = await UserService.formOptions(ctx);
  return (
    <>
      <PageHeader title="Invite user" description="Patient portal accounts are created from the patient's record instead." />
      <Card>
        <CreateUserForm action={createUserAction} roles={roles} orgs={orgs} />
      </Card>
    </>
  );
}
