"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { InboxService } from "@/modules/notifications/inbox.service";

export async function markReadAction(ids: string[] | "all"): Promise<ActionResult<number>> {
  const r = await runAction("notifications.mark_read", async () => InboxService.markRead(await actionContext(), ids));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
