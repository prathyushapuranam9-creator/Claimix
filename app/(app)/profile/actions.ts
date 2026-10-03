"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { authService } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/actions";
import { UserService } from "@/modules/users/users.service";
import type { ProfileUpdateInput } from "@/modules/users/users.validation";
import type { ChangePasswordInput } from "@/modules/auth/auth.validation";

/** Updates the signed-in user's own profile; the user is taken from the session, never from the request. */
export async function updateProfileAction(input: ProfileUpdateInput): Promise<ActionResult<{ fullName: string; email: string }>> {
  const r = await runAction("profile.update", async () => {
    const ctx = await actionContext();
    return UserService.updateOwnProfile(ctx, input, (password) => authService().confirmCurrentPassword(ctx.principal, password, ctx.meta));
  });
  // The name also shows in the taskbar and sidebar.
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Changes the signed-in user's password after re-checking the current one. */
export async function changePasswordAction(input: ChangePasswordInput): Promise<ActionResult> {
  return runAction("profile.change_password", async () => {
    const ctx = await actionContext();
    await authService().changePassword(ctx.principal, input, ctx.meta);
    return undefined;
  });
}
