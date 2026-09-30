"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { AccessRequestService } from "@/modules/access-requests/access-requests.service";
import type { AccessRequestDecisionInput } from "@/modules/access-requests/access-requests.validation";

export async function decideAccessRequestAction(id: string, input: AccessRequestDecisionInput): Promise<ActionResult> {
  const r = await runAction("access_request.decide", async () => {
    await AccessRequestService.decide(await actionContext(), id, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/admin/access-requests");
  return r;
}
