import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { Details } from "@/components/ui/Form";
import { Card, PageHeader } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Profile Settings · Claimix" };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Profile Settings" />
      <Card>
        <Details items={[["Name", user.fullName], ["Email", user.email], ["Role", user.roleName], ["Organization", user.orgName]]} />
      </Card>
    </>
  );
}
