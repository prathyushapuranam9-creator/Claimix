"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { runAction, type ActionResult } from "@/lib/actions";
import { authService, clearSessionCookie, requestMeta, sessionToken, setSessionCookie } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { AccessRequestService } from "@/modules/access-requests/access-requests.service";
import type { AccessRequestInput } from "@/modules/access-requests/access-requests.validation";

/** Only same-site relative paths are accepted as post-login targets (no open redirect). */
function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : "/dashboard";
}

export async function loginAction(input: { email: string; password: string; next?: string }): Promise<ActionResult> {
  const result = await runAction("auth.login", async () => {
    const { token, expiresAt } = await authService().login(input, await requestMeta());
    await setSessionCookie(token, expiresAt);
    return undefined;
  });
  if (result.ok) redirect(safeNext(input.next));
  return result;
}

export async function logoutAction(): Promise<void> {
  await authService().logout(await sessionToken(), await requestMeta());
  await clearSessionCookie();
  redirect("/login");
}

export async function forgotPasswordAction(input: { email: string }): Promise<ActionResult> {
  return runAction("auth.forgot_password", async () => {
    await authService().requestPasswordReset(input, await requestMeta());
    return undefined;
  });
}

/** Public: records a request for an administrator to review. Never creates an account. */
export async function requestAccessAction(input: AccessRequestInput): Promise<ActionResult> {
  return runAction("access_request.submit", async () => {
    await AccessRequestService.submit(getDb(), input, await requestMeta(), env().SESSION_SECRET);
    return undefined;
  });
}

export async function resetPasswordAction(input: { token: string; password: string; confirmPassword: string }): Promise<ActionResult> {
  return runAction("auth.reset_password", async () => {
    await authService().resetPassword(input, await requestMeta());
    return undefined;
  });
}
