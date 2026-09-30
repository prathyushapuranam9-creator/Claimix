"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { OrganizationService } from "@/modules/organizations/organizations.service";

export async function setOrganizationActiveAction(id: string, active: boolean, path: string): Promise<ActionResult> {
  const r = await runAction("organization.set_active", async () => {
    await OrganizationService.setActive(await actionContext(), id, active);
    return undefined;
  });
  // Only revalidate app-internal paths.
  if (r.ok && /^\/[a-z-]+\/[0-9a-f-]{36}$/.test(path)) revalidatePath(path);
  return r;
}
