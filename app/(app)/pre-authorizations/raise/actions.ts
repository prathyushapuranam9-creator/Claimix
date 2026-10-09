"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ValidationError } from "@/lib/errors";
import { maskAadhaar } from "@/lib/india";
import { todayIso } from "@/lib/validation";
import { coverPeriodStatus } from "@/modules/patients/coverage.validation";
import { DocumentService } from "@/modules/documents/documents.service";
import { PreauthService, type PolicyStatus } from "@/modules/preauth/preauth.service";
import type { KycVerification } from "@/modules/preauth/kyc-verification";
import { RegistrationService } from "@/modules/preauth/registration.service";
import type { PatientSuggestion } from "@/components/preauth/wizard/PatientFinder";
import type { PreauthDetailsInput, QuickFixInput, WizardKycInput } from "@/modules/preauth/preauth.validation";

/*
 * New Claim (insurer / TPA reviewer raising a cashless case on the hospital's behalf). Every action re-checks
 * the caller on the server: preauth:raise, an insurer / TPA organization, its own member, and a draft its own
 * organization raised. Nothing the browser sends is trusted for scope.
 */

const PATH = "/pre-authorizations/raise";

async function step(name: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  const r = await runAction(name, async () => {
    await fn();
    return undefined;
  });
  if (r.ok) revalidatePath(PATH);
  return r;
}

async function fileOf(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Choose a file.");
  return { name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Find the Patient suggestions while typing: the reviewer's own members only, at most 8. */
export async function suggestPatientsAction(q: string): Promise<ActionResult<PatientSuggestion[]>> {
  return runAction("preauth.suggest_patients", async () => {
    const today = todayIso();
    const rows = await PreauthService.members(await actionContext(), q, { limit: 8 });
    return rows.map((m) => ({
      beneficiaryId: m.beneficiaryId,
      fullName: m.fullName,
      patientNo: m.patientNo,
      dob: m.dob,
      phone: m.phone,
      memberId: m.memberId,
      policyName: m.policyName,
      aadhaar: maskAadhaar(m.aadhaarLast4),
      inForce: coverPeriodStatus(m, today) === "in_force",
    }));
  });
}

/** KYC & Policy → Patient KYC → Re-verify via Aadhaar / UHID (against the patient record; nothing is stored). */
export async function verifyKycAction(beneficiaryId: string, input: unknown): Promise<ActionResult<KycVerification>> {
  return runAction("kyc.reverify", async () => PreauthService.verifyKyc(await actionContext(), beneficiaryId, input));
}

/** KYC & Policy → Policy Verification: coverage, balance, rules and warnings for the member. */
export async function policyStatusAction(beneficiaryId: string, typed: { policyNumber?: string; memberId?: string }, caseId?: string): Promise<ActionResult<PolicyStatus>> {
  return runAction("kyc.policy_status", async () => PreauthService.policyStatus(await actionContext(), beneficiaryId, typed, caseId));
}

/** KYC & Policy → Next: creates the draft case and returns its id. */
export async function raiseCaseAction(input: { beneficiaryId?: string; kyc: WizardKycInput }): Promise<ActionResult<string>> {
  return runAction("preauth.raise", async () => (await PreauthService.raise(await actionContext(), input)).id);
}

/** KYC & Policy on an existing draft. */
export async function saveKycAction(id: string, input: WizardKycInput) {
  return step("preauth.kyc_update", async () => PreauthService.saveKyc(await actionContext(), id, input));
}

/** Clinical Details & Package → Register the Case. */
export async function saveClinicalAction(id: string, input: PreauthDetailsInput) {
  return step("preauth.wizard_clinical", async () => PreauthService.saveClinical(await actionContext(), id, input));
}

/** AI Pre-Scrutiny quick fix: a few Clinical Details & Package fields, merged into the saved case. */
export async function quickFixAction(id: string, input: QuickFixInput) {
  return step("preauth.quick_fix", async () => PreauthService.quickFix(await actionContext(), id, input));
}

/** One file per call (the browser sends several in turn for a multi-file drop). */
export async function uploadWizardDocumentAction(id: string, form: FormData): Promise<ActionResult> {
  return step("document.upload", async () => {
    const docType = form.get("docType");
    if (typeof docType !== "string") throw new ValidationError("Choose a document type and a file.");
    await DocumentService.upload(await actionContext(), { subjectType: "preauth", subjectId: id, docType, file: await fileOf(form) });
  });
}

export async function removeWizardDocumentAction(documentId: string) {
  return step("document.delete", async () => DocumentService.remove(await actionContext(), documentId));
}

/** Checks → Run Checks: the policy's published rules on the stored case (recorded and audited). */
export async function runAuditChecksAction(id: string) {
  return step("preauth.run_checks", async () => PreauthService.runChecks(await actionContext(), id));
}

/** Confirms a manual checklist item, or records a verification note for a rules item awaiting verification. */
export async function confirmWizardItemAction(id: string, input: { key: string; confirmed: boolean; note?: string }) {
  return step("preauth.confirm_item", async () => PreauthService.confirmItem(await actionContext(), id, input));
}

/** Submit: to the payer's review queue in Claimix, with the gaps acknowledgment when there are any. */
export async function submitWizardAction(id: string, input: { acknowledged: boolean }) {
  const r = await step("preauth.wizard_submit", async () => PreauthService.wizardSubmit(await actionContext(), id, input));
  if (r.ok) revalidatePath(`/pre-authorizations/${id}`);
  return r;
}

/** Register Case → Print / Download / Save → Save: a copy of the form filed with the case. */
export async function saveRegistrationCopyAction(id: string, input: { signature?: string | null }): Promise<ActionResult<string>> {
  const r = await runAction("preauth.registration_copy", async () => (await RegistrationService.saveCopy(await actionContext(), id, input)).documentId);
  if (r.ok) revalidatePath(PATH);
  return r;
}

/** Register Case → Submit: the signed form saved with the case and the patient's record. */
export async function submitRegistrationAction(id: string, input: { signature: string | null }): Promise<ActionResult<{ documentId: string; duplicate: boolean }>> {
  const r = await runAction("preauth.case_registered", async () => RegistrationService.submit(await actionContext(), id, input));
  if (r.ok) {
    revalidatePath(PATH);
    revalidatePath("/patients", "layout");
  }
  return r;
}
