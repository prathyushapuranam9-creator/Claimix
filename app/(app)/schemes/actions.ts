"use server";

import { redirect } from "next/navigation";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { SchemeService } from "@/modules/schemes/schemes.service";
import type { SchemeInput } from "@/modules/schemes/schemes.validation";

export async function createSchemeAction(input: SchemeInput): Promise<ActionResult> {
  const r = await runAction("scheme.create", async () => (await SchemeService.create(await actionContext(), input)).id);
  if (r.ok) redirect(`/schemes/${r.data}`);
  return r;
}
