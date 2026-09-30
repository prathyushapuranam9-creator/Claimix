"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { env } from "@/lib/config/env";
import { runAction, type ActionResult } from "@/lib/actions";
import { UserService } from "@/modules/users/users.service";
import type { UserCreateInput, UserUpdateInput } from "@/modules/users/users.validation";

export async function createUserAction(input: UserCreateInput): Promise<ActionResult> {
  const r = await runAction("user.create", async () => (await UserService.create(await actionContext(), input, env().APP_URL)).id);
  if (r.ok) redirect(`/admin/users/${r.data}?invited=1`);
  return r;
}

export async function updateUserAction(id: string, input: UserUpdateInput): Promise<ActionResult> {
  const r = await runAction("user.update", async () => {
    await UserService.update(await actionContext(), id, input);
    return undefined;
  });
  if (r.ok) revalidatePath(`/admin/users/${id}`);
  return r;
}

export async function revokeUserSessionsAction(id: string): Promise<ActionResult> {
  return runAction("user.revoke_sessions", async () => {
    await UserService.revokeSessions(await actionContext(), id);
    return undefined;
  });
}

export async function resendInviteAction(id: string): Promise<ActionResult> {
  return runAction("user.resend_invite", async () => {
    await UserService.resendInvite(await actionContext(), id, env().APP_URL);
    return undefined;
  });
}
