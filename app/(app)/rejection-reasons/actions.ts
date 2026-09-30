"use server";

import { redirect } from "next/navigation";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ReasonService } from "@/modules/reasons/reasons.service";
import type { ReasonInput } from "@/modules/reasons/reasons.validation";

export async function updateReasonAction(id: string, input: ReasonInput): Promise<ActionResult> {
  const r = await runAction("reason.update", async () => {
    await ReasonService.update(await actionContext(), id, input);
    return undefined;
  });
  if (r.ok) redirect("/rejection-reasons");
  return r;
}
