"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { DoctorService } from "@/modules/scheduling/scheduling.service";
import type { DoctorInput, SlotOpeningInput } from "@/modules/scheduling/scheduling.validation";

export async function addDoctorAction(input: DoctorInput): Promise<ActionResult> {
  const r = await runAction("doctor.create", async () => {
    await DoctorService.add(await actionContext(), input);
    return undefined;
  });
  if (r.ok) revalidatePath("/admin/doctors");
  return r;
}

export async function openSlotsAction(input: SlotOpeningInput): Promise<ActionResult<{ opened: number; requested: number }>> {
  const r = await runAction("doctor.open_slots", async () => DoctorService.openSlots(await actionContext(), input));
  if (r.ok) revalidatePath("/admin/doctors");
  return r;
}
