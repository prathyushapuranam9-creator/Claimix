"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { DocumentService } from "@/modules/documents/documents.service";
import type { DocumentReviewInput } from "@/modules/documents/documents.validation";

/** Hospital staff delete a document they uploaded (the service decides whether this one may be deleted). */
export async function deleteDocumentAction(docId: string): Promise<ActionResult> {
  const r = await runAction("document.delete", async () => {
    await DocumentService.remove(await actionContext(), docId);
    return undefined;
  });
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function reviewDocumentAction(docId: string, input: DocumentReviewInput): Promise<ActionResult> {
  const r = await runAction("document.review", async () => {
    await DocumentService.review(await actionContext(), docId, input);
    return undefined;
  });
  // The document can sit on a pre-auth or claim page; refresh all views.
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
