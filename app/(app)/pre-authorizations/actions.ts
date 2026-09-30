"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { ValidationError } from "@/lib/errors";
import { DocumentService } from "@/modules/documents/documents.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import type { DecisionInput, PreauthCreateInput, PreauthDetailsInput } from "@/modules/preauth/preauth.validation";

const path = (id: string) => `/pre-authorizations/${id}`;

async function step(name: string, id: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  const r = await runAction(name, async () => {
    await fn();
    return undefined;
  });
  if (r.ok) revalidatePath(path(id));
  return r;
}

export async function createPreauthAction(input: PreauthCreateInput): Promise<ActionResult> {
  const r = await runAction("preauth.create", async () => (await PreauthService.create(await actionContext(), input)).id);
  if (r.ok) redirect(path(r.data));
  return r;
}

export async function updatePreauthAction(id: string, input: PreauthDetailsInput) {
  return step("preauth.update", id, async () => PreauthService.update(await actionContext(), id, input));
}

export async function runChecksAction(id: string) {
  return step("preauth.run_checks", id, async () => PreauthService.runChecks(await actionContext(), id));
}

export async function confirmItemAction(id: string, input: { key: string; confirmed: boolean; note?: string }) {
  return step("preauth.confirm_item", id, async () => PreauthService.confirmItem(await actionContext(), id, input));
}

export async function submitPreauthAction(id: string, input: { overrideReason?: string }) {
  return step("preauth.submit", id, async () => PreauthService.submit(await actionContext(), id, input));
}

export async function decidePreauthAction(id: string, input: DecisionInput) {
  return step("preauth.decide", id, async () => PreauthService.decide(await actionContext(), id, input));
}

export async function respondToQueryAction(id: string, input: { message: string }) {
  return step("preauth.respond", id, async () => PreauthService.respondToQuery(await actionContext(), id, input));
}

export async function cancelPreauthAction(id: string, input: { message: string }) {
  return step("preauth.cancel", id, async () => PreauthService.cancel(await actionContext(), id, input));
}

export async function uploadDocumentAction(id: string, form: FormData): Promise<ActionResult> {
  return step("document.upload", id, async () => {
    const file = form.get("file");
    const docType = form.get("docType");
    if (!(file instanceof File) || typeof docType !== "string") throw new ValidationError("Choose a document type and a file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await DocumentService.upload(await actionContext(), { subjectType: "preauth", subjectId: id, docType, file: { name: file.name, size: file.size, bytes } });
  });
}
