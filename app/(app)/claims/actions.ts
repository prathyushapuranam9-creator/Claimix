"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ValidationError } from "@/lib/errors";
import { ClaimService } from "@/modules/claims/claims.service";
import type { CashlessClaimInput, ClaimDecisionInput, ClaimDetailsInput, ReimbursementClaimInput, SettlementInput } from "@/modules/claims/claims.validation";
import { DocumentService } from "@/modules/documents/documents.service";

const path = (id: string) => `/claims/${id}`;

async function step(name: string, id: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  const r = await runAction(name, async () => {
    await fn();
    return undefined;
  });
  if (r.ok) revalidatePath(path(id));
  return r;
}

export async function createCashlessClaimAction(input: CashlessClaimInput): Promise<ActionResult> {
  const r = await runAction("claim.create_cashless", async () => (await ClaimService.createCashless(await actionContext(), input)).id);
  if (r.ok) redirect(path(r.data));
  return r;
}

export async function createReimbursementClaimAction(input: ReimbursementClaimInput): Promise<ActionResult> {
  const r = await runAction("claim.create_reimbursement", async () => (await ClaimService.createReimbursement(await actionContext(), input)).id);
  if (r.ok) redirect(path(r.data));
  return r;
}

export async function updateClaimAction(id: string, input: ClaimDetailsInput) {
  return step("claim.update", id, async () => ClaimService.update(await actionContext(), id, input));
}

export async function runClaimChecksAction(id: string) {
  return step("claim.run_checks", id, async () => ClaimService.runChecks(await actionContext(), id));
}

export async function confirmClaimItemAction(id: string, input: { key: string; confirmed: boolean; note?: string }) {
  return step("claim.confirm_item", id, async () => ClaimService.confirmItem(await actionContext(), id, input));
}

export async function submitClaimAction(id: string, input: { overrideReason?: string }) {
  return step("claim.submit", id, async () => ClaimService.submit(await actionContext(), id, input));
}

export async function decideClaimAction(id: string, input: ClaimDecisionInput) {
  return step("claim.decide", id, async () => ClaimService.decide(await actionContext(), id, input));
}

export async function respondClaimQueryAction(id: string, input: { message: string }) {
  return step("claim.respond", id, async () => ClaimService.respondToQuery(await actionContext(), id, input));
}

export async function cancelClaimAction(id: string, input: { message: string }) {
  return step("claim.cancel", id, async () => ClaimService.cancel(await actionContext(), id, input));
}

export async function settleClaimAction(id: string, input: SettlementInput) {
  return step("claim.settle", id, async () => ClaimService.settle(await actionContext(), id, input));
}

export async function uploadClaimDocumentAction(id: string, form: FormData): Promise<ActionResult> {
  return step("document.upload", id, async () => {
    const file = form.get("file");
    const docType = form.get("docType");
    if (!(file instanceof File) || typeof docType !== "string") throw new ValidationError("Choose a document type and a file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await DocumentService.upload(await actionContext(), { subjectType: "claim", subjectId: id, docType, file: { name: file.name, size: file.size, bytes } });
  });
}
