"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ClinicalService } from "@/modules/clinical/clinical.service";
import type { DiagnosisInput, ProcedureInput } from "@/modules/clinical/clinical.validation";

export async function addDiagnosisAction(input: DiagnosisInput): Promise<ActionResult> {
  const r = await runAction("diagnosis.create", async () => {
    await ClinicalService.addDiagnosis(await actionContext(), input);
    return undefined;
  });
  if (r.ok) revalidatePath("/admin/medical-codes");
  return r;
}

export async function addProcedureAction(input: ProcedureInput): Promise<ActionResult> {
  const r = await runAction("procedure.create", async () => {
    await ClinicalService.addProcedure(await actionContext(), input);
    return undefined;
  });
  if (r.ok) revalidatePath("/admin/medical-codes");
  return r;
}
