"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import type { HospitalInput, NetworkInput } from "@/modules/hospitals/hospitals.validation";

export async function createHospitalAction(input: HospitalInput): Promise<ActionResult> {
  const r = await runAction("hospital.create", async () => (await HospitalService.create(await actionContext(), input)).id);
  if (r.ok) redirect(`/hospitals/${r.data}`);
  return r;
}

export async function updateHospitalAction(id: string, input: HospitalInput): Promise<ActionResult> {
  const r = await runAction("hospital.update", async () => (await HospitalService.update(await actionContext(), id, input)).id);
  if (r.ok) redirect(`/hospitals/${r.data}`);
  return r;
}

export async function setNetworkAction(hospitalId: string, input: NetworkInput): Promise<ActionResult> {
  const r = await runAction("hospital.set_network", async () => {
    await HospitalService.setNetwork(await actionContext(), hospitalId, input);
    return undefined;
  });
  if (r.ok) revalidatePath(`/hospitals/${hospitalId}`);
  return r;
}
