import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ProfileSettings } from "@/components/profile/ProfileSettings";
import { changePasswordAction, updateProfileAction } from "./actions";

export const metadata: Metadata = { title: "Profile Settings · Claimix" };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      {/* The page header (with Change Password) is rendered by ProfileSettings. key: another signed-in user always starts from their own session values. */}
      <ProfileSettings
        key={user.principal.userId}
        user={{ fullName: user.fullName, email: user.email, roleName: user.roleName, orgName: user.orgName }}
        action={updateProfileAction}
        changePassword={changePasswordAction}
      />
    </>
  );
}
