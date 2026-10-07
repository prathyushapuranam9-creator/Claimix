"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ValidationError } from "@/lib/errors";
import { DocumentService } from "@/modules/documents/documents.service";
import { PatientService } from "@/modules/patients/patients.service";
import type { PatientInput } from "@/modules/patients/patients.validation";
import { CoverageService } from "@/modules/patients/coverage.service";
import type { CoverageInput } from "@/modules/patients/coverage.validation";
import { PatientEligibilityService, type PatientEligibilityResult } from "@/modules/eligibility/patient-eligibility.service";

/** Patient Profile "Eligibility Check": the server re-validates the patient and that the coverage is theirs. */
export async function checkPatientEligibilityAction(patientId: string, beneficiaryId: string): Promise<ActionResult<PatientEligibilityResult>> {
  return runAction("patient.eligibility_check", async () => PatientEligibilityService.check(await actionContext(), patientId, beneficiaryId));
}

export async function createPatientAction(input: PatientInput): Promise<ActionResult> {
  const r = await runAction("patient.create", async () => (await PatientService.create(await actionContext(), input)).id);
  // Straight to the new patient, where the next step (insurance coverage) is offered.
  if (r.ok) redirect(`/patients/${r.data}?registered=1`);
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
  if (r.ok) {
    revalidatePath(`/patients/${patientId}`);
    // Clears ?fromDocument and confirms the next step (check eligibility).
    redirect(`/patients/${patientId}?coverage=added`);
  }
  return r;
}

export async function updateCoverageAction(patientId: string, beneficiaryId: string, input: CoverageInput): Promise<ActionResult> {
  const r = await runAction("coverage.update", async () => {
    await CoverageService.update(await actionContext(), beneficiaryId, input);
    return undefined;
  });
  if (r.ok) {
    revalidatePath(`/patients/${patientId}`);
    redirect(`/patients/${patientId}`);
  }
  return r;
}

/**
 * Stage A upload: an insurance card, policy copy or scheme enrolment document for this patient. The
 * patient is taken from the path and re-resolved inside the caller's scope on the server.
 */
export async function uploadInsuranceDocumentAction(patientId: string, form: FormData): Promise<ActionResult> {
  const r = await runAction("document.upload_insurance", async () => {
    const file = form.get("file");
    const docType = form.get("docType");
    if (!(file instanceof File) || typeof docType !== "string") throw new ValidationError("Choose a document type and a file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await DocumentService.uploadInsuranceDocument(await actionContext(), patientId, { docType, file: { name: file.name, size: file.size, bytes } });
    return undefined;
  });
  if (r.ok) revalidatePath(`/patients/${patientId}`);
  return r;
}
