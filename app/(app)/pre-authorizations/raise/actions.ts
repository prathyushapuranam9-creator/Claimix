"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ValidationError } from "@/lib/errors";
import { DocumentService } from "@/modules/documents/documents.service";
import { KycCardService, type KycCardReading } from "@/modules/preauth/kyc-card.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import type { PreauthDetailsInput, WizardKycInput } from "@/modules/preauth/preauth.validation";

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

/** KYC & Policy → "Use These Details": reads the dropped policy card (not stored by this call). */
export async function readCardAction(form: FormData): Promise<ActionResult<KycCardReading>> {
  return runAction("kyc.card_read", async () => KycCardService.read(await actionContext(), await fileOf(form)));
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
