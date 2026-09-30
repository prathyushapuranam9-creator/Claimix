"use server";

import { redirect } from "next/navigation";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { InsurerService } from "@/modules/insurers/insurers.service";
import type { InsurerInput, TpaInput } from "@/modules/insurers/insurers.validation";
import { TpaService } from "@/modules/tpas/tpas.service";

export async function createInsurerAction(input: InsurerInput): Promise<ActionResult> {
  const r = await runAction("insurer.create", async () => (await InsurerService.create(await actionContext(), input)).id);
  if (r.ok) redirect(`/insurers/${r.data}`);
  return r;
}

export async function updateInsurerAction(id: string, input: InsurerInput): Promise<ActionResult> {
  const r = await runAction("insurer.update", async () => (await InsurerService.update(await actionContext(), id, input)).id);
  if (r.ok) redirect(`/insurers/${r.data}`);
  return r;
}

export async function createTpaAction(input: TpaInput): Promise<ActionResult> {
  const r = await runAction("tpa.create", async () => (await TpaService.create(await actionContext(), input)).id);
  if (r.ok) redirect(`/tpas/${r.data}`);
  return r;
}

export async function updateTpaAction(id: string, input: TpaInput): Promise<ActionResult> {
  const r = await runAction("tpa.update", async () => (await TpaService.update(await actionContext(), id, input)).id);
  if (r.ok) redirect(`/tpas/${r.data}`);
  return r;
}
