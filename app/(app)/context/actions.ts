"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { authService, clearContextCookie, requestMeta, sessionToken, setContextCookie } from "@/lib/auth/session";

/**
 * Switch the insurance-portal testing context. Authorization happens in AuthService: only an account that holds
 * `insurance:context` may do this, and only to an existing insurer / TPA with one of its own roles.
 */
export async function switchContextAction(input: { organizationId: string; roleKey: string; policyId?: string | null }): Promise<ActionResult> {
  return runAction("context.switch", async () => {
    const { contextToken } = await authService().switchContext(await sessionToken(), input, await requestMeta());
    await setContextCookie(contextToken);
    revalidatePath("/", "layout");
    return undefined;
  });
}

/** Back to the account's own view ("All Insurers", no role). */
export async function exitContextAction(): Promise<ActionResult> {
  return runAction("context.exit", async () => {
    await authService().clearContext(await sessionToken(), await requestMeta());
    await clearContextCookie();
    revalidatePath("/", "layout");
    return undefined;
  });
}
