"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ValidationError } from "@/lib/errors";
import { DocumentService } from "@/modules/documents/documents.service";
import { PatientService } from "@/modules/patients/patients.service";
import { PolicyCheckService } from "@/modules/patients/policy-check.service";
import { ClaimService } from "@/modules/claims/claims.service";
import type { PatientInput } from "@/modules/patients/patients.validation";
import { CoverageService } from "@/modules/patients/coverage.service";
import type { CoverageInput } from "@/modules/patients/coverage.validation";
import { PatientEligibilityService, type PatientEligibilityResult } from "@/modules/eligibility/patient-eligibility.service";

/** Patient Profile "Eligibility Check": the server re-validates the patient and that the coverage is theirs. */
export async function checkPatientEligibilityAction(patientId: string, beneficiaryId: string): Promise<ActionResult<PatientEligibilityResult>> {
  return runAction("patient.eligibility_check", async () => PatientEligibilityService.check(await actionContext(), patientId, beneficiaryId));
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

/**
 * Patient Details "Submit": starts the (draft) cashless claim from this patient's approved pre-authorization, which
 * moves the patient from Patients → Pre-Auth to Patients → Claims. The pre-auth must be this patient's;
 * ClaimService.createCashless enforces the rest (hospital staff, approved status, no live claim on it).
 */
export async function submitPatientToClaimsAction(patientId: string, preAuthId: string): Promise<ActionResult<string>> {
  const r = await runAction("patient.submit_to_claims", async () => {
    const ctx = await actionContext();
    const { preauths } = await PolicyCheckService.forPatient(ctx, patientId);
    if (!preauths?.some((p) => p.id === preAuthId)) throw new ValidationError("That pre-authorization isn't this patient's.");
    return (await ClaimService.createCashless(ctx, { preAuthId })).id;
  });
  if (r.ok) {
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/patients");
  }
  return r;
}
