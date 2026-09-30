"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { PatientService } from "@/modules/patients/patients.service";
import type { PatientInput } from "@/modules/patients/patients.validation";
import { CoverageService } from "@/modules/patients/coverage.service";
import type { CoverageInput } from "@/modules/patients/coverage.validation";

export async function createPatientAction(input: PatientInput): Promise<ActionResult> {
  const r = await runAction("patient.create", async () => (await PatientService.create(await actionContext(), input)).id);
  if (r.ok) redirect(`/patients/${r.data}`);
  return r;
}

export async function updatePatientAction(id: string, input: PatientInput): Promise<ActionResult> {
  const r = await runAction("patient.update", async () => (await PatientService.update(await actionContext(), id, input)).id);
  if (r.ok) redirect(`/patients/${r.data}`);
  return r;
}

export async function addCoverageAction(patientId: string, input: CoverageInput): Promise<ActionResult> {
  const r = await runAction("coverage.add", async () => {
    await CoverageService.add(await actionContext(), patientId, input);
    return undefined;
  });
  if (r.ok) revalidatePath(`/patients/${patientId}`);
  return r;
}
